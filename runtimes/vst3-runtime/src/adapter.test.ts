import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import { afterAll, describe, expect, it } from 'vitest';

import {
  type AdapterManifest,
  adapterManifest,
  resolveAdapter,
  sourceAdapter,
} from './adapter';

const work = mkdtempSync(join(tmpdir(), 'vst3-adapter-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const fingerprint = 'f'.repeat(64);
const engine = { version: '0.9.0', sourceFingerprint: fingerprint };

function adapterJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: 1,
    runtimeVersion: '1.2.3',
    target: 'linux-x64',
    variant: 'release',
    vst3sdk: '3.8.1',
    engine: { version: '0.9.0', sourceFingerprint: fingerprint },
    ...overrides,
  });
}

/** A ustar archive with one top directory, as vst3-adapters.mjs packs one. */
function archive(top: string, entries: Record<string, string>): Buffer {
  const blocks: Buffer[] = [];
  for (const [path, contents] of Object.entries(entries)) {
    const data = Buffer.from(contents);
    const header = Buffer.alloc(512);
    const octal = (offset: number, length: number, value: number) =>
      header.write(
        `${value.toString(8).padStart(length - 1, '0')}\0`,
        offset,
        length,
        'ascii',
      );
    header.write(`${top}/${path}`, 0, 100, 'utf8');
    octal(100, 8, 0o644);
    octal(108, 8, 0);
    octal(116, 8, 0);
    octal(124, 12, data.length);
    octal(136, 12, 0);
    header.fill(' ', 148, 156);
    header.write('0', 156, 1, 'ascii');
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

/** An installed package: package.json and artifacts/manifest.json. */
function installed(
  edit: (manifest: AdapterManifest) => AdapterManifest = (m) => m,
  files: Record<string, string> = {
    'adapter.json': adapterJson(),
    'lib/libsoundor_vst3.a': 'adapter',
    'licenses/vst3sdk/LICENSE.txt': 'Steinberg',
  },
): { root: string; archivePath: string } {
  const root = mkdtempSync(join(work, 'package-'));
  writeFileSync(join(root, 'package.json'), '{"version":"1.2.3"}');
  const file = 'soundor-vst3-adapter-1.2.3-linux-x64-release.tar.gz';
  const bytes = archive(file.replace(/\.tar\.gz$/, ''), files);
  const archivePath = join(root, file);
  writeFileSync(archivePath, bytes);
  const manifest: AdapterManifest = {
    format: 1,
    runtimeVersion: '1.2.3',
    sourceCommit: 'a'.repeat(40),
    revision: 1,
    tag: 'vst3-adapters-v1.2.3-aaaaaaaa-r1',
    release: null,
    engine,
    artifacts: [
      {
        file,
        target: 'linux-x64',
        variant: 'release',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        size: bytes.length,
        url: pathToFileURL(archivePath).href,
      },
    ],
  };
  mkdirSync(join(root, 'artifacts'));
  writeFileSync(
    join(root, 'artifacts', 'manifest.json'),
    JSON.stringify(edit(manifest)),
  );
  return { root, archivePath };
}

const quiet = { env: {}, log: () => {} };

describe('the adapter in a workspace', () => {
  function workspace(): string {
    const root = mkdtempSync(join(work, 'workspace-'));
    mkdirSync(join(root, 'native', 'tests'), { recursive: true });
    writeFileSync(join(root, 'native', 'tests', 'CMakeLists.txt'), '');
    writeFileSync(join(root, 'package.json'), '{"version":"0.0.0"}');
    return root;
  }

  it('is prebuilt/, built by build:native', async () => {
    const root = workspace();
    await expect(
      resolveAdapter(root, 'linux-x64', 'release', engine, quiet),
    ).rejects.toThrow(/adapter is missing.*build:native/);
    const stage = join(root, 'prebuilt', 'linux-x64-release');
    mkdirSync(join(stage, 'lib'), { recursive: true });
    writeFileSync(join(stage, 'lib', 'libsoundor_vst3.a'), 'adapter');
    writeFileSync(join(stage, 'adapter.json'), adapterJson());
    const resolved = await resolveAdapter(
      root,
      'linux-x64',
      'release',
      engine,
      quiet,
    );
    expect(resolved.archive).toBe(join(stage, 'lib', 'libsoundor_vst3.a'));
    expect(resolved.directory).toBe(stage);
  });

  it('refuses one built against another engine', async () => {
    const root = workspace();
    const stage = join(root, 'prebuilt', 'linux-x64-release');
    mkdirSync(join(stage, 'lib'), { recursive: true });
    writeFileSync(join(stage, 'lib', 'libsoundor_vst3.a'), 'adapter');
    writeFileSync(join(stage, 'adapter.json'), adapterJson());
    await expect(
      resolveAdapter(
        root,
        'linux-x64',
        'release',
        { version: '0.9.0', sourceFingerprint: 'e'.repeat(64) },
        quiet,
      ),
    ).rejects.toThrow(/built against another engine.*build:native/);
  });
});

describe('the adapter of an installed package', () => {
  it('is downloaded once into the cache, checked, and extracted', async () => {
    const { root, archivePath } = installed();
    const cache = join(work, 'cache-installed');
    const messages: string[] = [];
    const resolved = await resolveAdapter(
      root,
      'linux-x64',
      'release',
      engine,
      {
        env: {},
        cache,
        log: (message) => messages.push(message),
      },
    );
    expect(resolved.archive.startsWith(join(cache, 'vst3-adapters'))).toBe(
      true,
    );
    expect(existsSync(join(resolved.directory, 'licenses', 'vst3sdk'))).toBe(
      true,
    );
    expect(resolved.reason).toMatch(/of vst3-adapters-v1\.2\.3-aaaaaaaa-r1$/);
    expect(messages.join('\n')).toMatch(/VST3 adapter: downloading/);
    // The cached extraction serves the next build, without the archive.
    rmSync(archivePath);
    const again = await resolveAdapter(root, 'linux-x64', 'release', engine, {
      env: {},
      cache,
      log: () => {},
    });
    expect(again.archive).toBe(resolved.archive);
  });

  it('refuses an archive that is not the one the manifest names', async () => {
    const { root } = installed((manifest) => ({
      ...manifest,
      artifacts: manifest.artifacts.map((a) => ({
        ...a,
        sha256: '0'.repeat(64),
      })),
    }));
    await expect(
      resolveAdapter(root, 'linux-x64', 'release', engine, {
        ...quiet,
        cache: join(work, 'cache-integrity'),
      }),
    ).rejects.toThrow(/is not the archive the manifest names/);
  });

  it('refuses adapters built against another engine before downloading', async () => {
    const { root } = installed();
    await expect(
      resolveAdapter(
        root,
        'linux-x64',
        'release',
        { version: '0.9.1', sourceFingerprint: fingerprint },
        { ...quiet, cache: join(work, 'cache-engine') },
      ),
    ).rejects.toThrow(/built against engine 0\.9\.0.*links 0\.9\.1/);
    expect(existsSync(join(work, 'cache-engine'))).toBe(false);
  });

  it('refuses an archive whose adapter is another runtime version', async () => {
    const { root } = installed(undefined, {
      'adapter.json': adapterJson({ runtimeVersion: '1.2.2' }),
      'lib/libsoundor_vst3.a': 'adapter',
    });
    await expect(
      resolveAdapter(root, 'linux-x64', 'release', engine, {
        ...quiet,
        cache: join(work, 'cache-version'),
      }),
    ).rejects.toThrow(/adapter of runtime 1\.2\.2, not 1\.2\.3/);
  });

  it('names a target or variant the release lacks', async () => {
    const { root } = installed();
    await expect(
      resolveAdapter(root, 'linux-x64', 'debug', engine, quiet),
    ).rejects.toThrow(/has no debug adapter for linux-x64/);
  });

  it('needs a manifest', () => {
    const root = mkdtempSync(join(work, 'unpublished-'));
    writeFileSync(join(root, 'package.json'), '{"version":"1.2.3"}');
    expect(() => adapterManifest(root, {})).toThrow(
      /has no adapter manifest.*only a published package/,
    );
    expect(() =>
      adapterManifest(root, { SOUNDOR_VST3_ADAPTER_MANIFEST: join(root, 'x') }),
    ).toThrow(/SOUNDOR_VST3_ADAPTER_MANIFEST names/);
  });

  it('rejects a manifest of another version', () => {
    const { root } = installed((manifest) => ({
      ...manifest,
      runtimeVersion: '1.2.4',
    }));
    expect(() => adapterManifest(root, {})).toThrow(
      /it is runtime 1\.2\.4, not 1\.2\.3/,
    );
  });
});

describe('the adapter built from source', () => {
  const sourceEngine = { ...engine, directory: '/engine' };

  /** A fake CMake build: stages what buildAdapter stages. */
  function fakeBuild(count: { builds: number }) {
    return (_build: string, stage: string) => {
      count.builds++;
      mkdirSync(join(stage, 'lib'), { recursive: true });
      writeFileSync(join(stage, 'lib', 'libsoundor_vst3.a'), 'adapter');
      writeFileSync(join(stage, 'adapter.json'), adapterJson());
    };
  }

  it('is built once per version, variant and engine in an installed package', async () => {
    const { root } = installed();
    const cache = join(work, 'cache-source');
    const count = { builds: 0 };
    const options = { ...quiet, cache, build: fakeBuild(count) };
    const first = await sourceAdapter(
      root,
      'linux-x64',
      'release',
      sourceEngine,
      options,
    );
    expect(first.archive).toBe(
      join(
        cache,
        'vst3-adapter-source',
        '1.2.3',
        `linux-x64-release-${fingerprint.slice(0, 16)}`,
        'stage',
        'lib',
        'libsoundor_vst3.a',
      ),
    );
    await sourceAdapter(root, 'linux-x64', 'release', sourceEngine, options);
    expect(count.builds).toBe(1);
  });

  it('is built again in the workspace, whose sources change', async () => {
    const root = mkdtempSync(join(work, 'workspace-source-'));
    mkdirSync(join(root, 'native', 'tests'), { recursive: true });
    writeFileSync(join(root, 'native', 'tests', 'CMakeLists.txt'), '');
    writeFileSync(join(root, 'package.json'), '{"version":"1.2.3"}');
    const count = { builds: 0 };
    const options = {
      ...quiet,
      cache: join(work, 'cache-source-workspace'),
      build: fakeBuild(count),
    };
    await sourceAdapter(root, 'linux-x64', 'release', sourceEngine, options);
    await sourceAdapter(root, 'linux-x64', 'release', sourceEngine, options);
    expect(count.builds).toBe(2);
  });

  it('reports a failed build', async () => {
    const { root } = installed();
    await expect(
      sourceAdapter(root, 'linux-x64', 'release', sourceEngine, {
        ...quiet,
        cache: join(work, 'cache-source-failed'),
        build: () => {
          throw new Error('cmake failed (exit 1)');
        },
      }),
    ).rejects.toThrow(/from source failed: cmake failed/);
  });
});
