// The native input fingerprint, executable resolution and prebuilt/source
// selection. Nothing here builds or downloads from the real registry.
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { nativeInputs } from '../../src/inputs.ts';
import { prepareHost, selectHost } from '../../src/prepare.ts';
import { PROVENANCE_FILE, sha256 } from '../../src/provenance.ts';
import { resolveHost, selectionFile } from '../../src/resolve.ts';
import { targets } from '../../src/targets.ts';
import {
  COMMIT,
  type FakeRegistry,
  artifact,
  fakeRegistry,
  here,
  npmPack,
  packageCopy,
  temporary,
} from './helpers.ts';

describe('native inputs', () => {
  test('change with native sources, not with anything else', () => {
    const root = packageCopy();
    const base = nativeInputs(root).fingerprint;
    const expectSame = () => expect(nativeInputs(root).fingerprint).toBe(base);

    // Unrelated: docs, tests, the client, the rest of package.json.
    writeFileSync(join(root, 'README.md'), 'changed');
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'host.ts'), 'export {};');
    writeFileSync(
      join(root, 'native', 'tests', 'fixtures', 'New.cpp'),
      '// test',
    );
    const manifest = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8'),
    );
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ ...manifest, scripts: { x: 'y' } }),
    );
    writeFileSync(join(root, 'native', 'src', '.Plugin.cpp.swp'), 'editor');
    expectSame();

    // An edit, and its reversion.
    const source = join(root, 'native', 'src', 'Plugin.cpp');
    const original = readFileSync(source);
    writeFileSync(
      source,
      Buffer.concat([original, Buffer.from('\n// edit\n')]),
    );
    const edited = nativeInputs(root).fingerprint;
    expect(edited).not.toBe(base);
    writeFileSync(source, original);
    expectSame();

    // Line endings do not matter.
    writeFileSync(source, original.toString('utf8').replaceAll('\n', '\r\n'));
    expectSame();
    writeFileSync(source, original);

    // An addition, a deletion, a rename.
    writeFileSync(join(root, 'native', 'src', 'Extra.h'), '#pragma once\n');
    const added = nativeInputs(root).fingerprint;
    expect(added).not.toBe(base);
    renameSync(
      join(root, 'native', 'src', 'Extra.h'),
      join(root, 'native', 'src', 'Other.h'),
    );
    expect(nativeInputs(root).fingerprint).not.toBe(added);
    rmSync(join(root, 'native', 'src', 'Other.h'));
    expectSame();
    rmSync(join(root, 'native', 'src', 'Json.h'));
    expect(nativeInputs(root).fingerprint).not.toBe(base);
  });

  test('change with the dependency pin, the protocol and the version', () => {
    const root = packageCopy();
    const base = nativeInputs(root).fingerprint;
    const pin = join(root, 'cmake', 'Vst3HostDependencies.cmake');
    writeFileSync(pin, readFileSync(pin, 'utf8').replace('3.8.1', '3.8.2'));
    expect(nativeInputs(root).fingerprint).not.toBe(base);

    const other = packageCopy();
    writeFileSync(join(other, 'protocol.json'), JSON.stringify({ version: 2 }));
    expect(nativeInputs(other).fingerprint).not.toBe(base);
    expect(nativeInputs(packageCopy(undefined, '0.3.1')).fingerprint).not.toBe(
      base,
    );
  });
});

describe('resolveHost', () => {
  function installed(version = '0.3.0', platformVersion = version) {
    const root = temporary();
    const main = join(root, 'node_modules', '@soundor', 'vst3-host');
    mkdirSync(main, { recursive: true });
    writeFileSync(
      join(main, 'package.json'),
      JSON.stringify({
        name: '@soundor/vst3-host',
        version,
        optionalDependencies: Object.fromEntries(
          targets.map((t) => [t.package, version]),
        ),
      }),
    );
    const platform = join(root, 'node_modules', ...here.package.split('/'));
    const provenance = artifact(platform, here, { version: platformVersion });
    writeFileSync(
      join(platform, 'package.json'),
      JSON.stringify({ name: here.package, version: platformVersion }),
    );
    return { main, platform, provenance };
  }

  test('finds the platform package of the same version', () => {
    const { main, platform } = installed();
    const resolved = resolveHost({ root: main });
    expect(resolved).toMatchObject({
      source: 'package',
      executable: join(platform, here.executable),
    });
  });

  test('refuses a platform package of another version', () => {
    const { main } = installed('0.3.0', '0.2.0');
    expect(() => resolveHost({ root: main })).toThrow(/needs exactly 0\.3\.0/);
  });

  test('says when optional dependencies were omitted', () => {
    const { main, platform } = installed();
    rmSync(platform, { recursive: true });
    expect(() => resolveHost({ root: main })).toThrow(
      expect.objectContaining({
        code: 'platform-package-missing',
        message: expect.stringMatching(/--omit=optional/),
      }),
    );
  });

  test('refuses an executable that is not the recorded one', () => {
    const { main, platform } = installed();
    writeFileSync(join(platform, here.executable), 'tampered');
    expect(() => resolveHost({ root: main })).toThrow(/SHA-256 differs/);
  });

  test('takes an explicit executable, and says when it is missing', () => {
    expect(resolveHost({ executable: import.meta.filename }).source).toBe(
      'explicit',
    );
    expect(() => resolveHost({ executable: '/nowhere/host' })).toThrow(
      expect.objectContaining({ code: 'executable-not-found' }),
    );
  });

  test('in a checkout, needs a selection that matches its sources', () => {
    const root = packageCopy();
    expect(() => resolveHost({ root })).toThrow(/build:native/);
  });
});

describe('prepareHost', () => {
  let registry: FakeRegistry;
  beforeAll(async () => {
    registry = await fakeRegistry();
  });
  afterAll(() => registry.close());

  const quiet = () => {};
  function fakeBuild(root: string) {
    const calls: string[] = [];
    return {
      calls,
      build: (reason: string) => {
        calls.push(reason);
        const executable = join(root, 'build', 'fake', 'soundor-vst3-host');
        mkdirSync(join(root, 'build', 'fake'), { recursive: true });
        writeFileSync(executable, `built ${calls.length}`);
        chmodSync(executable, 0o755);
        return {
          executable,
          mode: 'source' as const,
          reason,
          sourceFingerprint: nativeInputs(root).fingerprint,
        };
      },
    };
  }

  /** Publishes, to the fake registry, the platform package built from `root`. */
  function publish(
    root: string,
    fingerprint = nativeInputs(root).fingerprint,
    version = '0.3.0',
  ) {
    const directory = temporary();
    artifact(directory, here, { version, sourceFingerprint: fingerprint });
    writeFileSync(
      join(directory, 'package.json'),
      JSON.stringify({ name: here.package, version }),
    );
    const tarball = npmPack(directory, temporary());
    registry.versions.set(`${here.package}@${version}`, readFileSync(tarball));
  }

  test('builds an unpublished version, and resolveHost then finds it', async () => {
    const root = packageCopy(undefined, '9.9.9');
    const { build, calls } = fakeBuild(root);
    const prepared = await prepareHost({
      root,
      registry: registry.url,
      cache: temporary(),
      build,
      log: quiet,
    });
    expect(calls).toEqual([
      `${here.package}@9.9.9 is not published; built from source`,
    ]);
    expect(resolveHost({ root })).toMatchObject({
      source: 'selection',
      executable: prepared.executable,
    });

    // An edit makes the selection stale until it is prepared again.
    writeFileSync(join(root, 'native', 'src', 'New.h'), '');
    expect(() => resolveHost({ root })).toThrow(/other native sources/);
  });

  test('downloads the published executable when the sources match, then reuses it offline', async () => {
    const root = packageCopy();
    publish(root);
    const cache = temporary();
    const { build, calls } = fakeBuild(root);
    const prepared = await prepareHost({
      root,
      registry: registry.url,
      cache,
      build,
      log: quiet,
    });
    expect(calls).toEqual([]);
    expect(prepared.mode).toBe('prebuilt');
    expect(readFileSync(prepared.executable, 'utf8')).toContain(here.target);
    expect(JSON.parse(readFileSync(selectionFile(root), 'utf8'))).toMatchObject(
      { mode: 'prebuilt' },
    );

    const offline = await prepareHost({
      root,
      registry: registry.url,
      cache,
      build,
      log: quiet,
      fetcher: () => Promise.reject(new Error('offline')),
    });
    expect(offline.executable).toBe(prepared.executable);
  });

  test('published mode never builds', async () => {
    const root = packageCopy(undefined, '9.9.9');
    const { build, calls } = fakeBuild(root);
    await expect(
      prepareHost({
        root,
        mode: 'published',
        registry: registry.url,
        cache: temporary(),
        build,
        log: quiet,
      }),
    ).rejects.toThrow(/no published VST3 host executable.*is not published/);
    expect(calls).toEqual([]);
  });

  test('selectHost plans a build for an unpublished version', async () => {
    const root = packageCopy(undefined, '9.9.9');
    await expect(
      selectHost({ root, registry: registry.url, cache: temporary() }),
    ).resolves.toEqual({
      mode: 'source',
      reason: `${here.package}@9.9.9 is not published`,
    });
  });

  test('selectHost plans on a published version that matches', async () => {
    const root = packageCopy();
    publish(root);
    await expect(
      selectHost({ root, registry: registry.url, cache: temporary() }),
    ).resolves.toMatchObject({ mode: 'prebuilt' });
  });

  test('builds when the sources differ from the published version', async () => {
    const root = packageCopy();
    publish(root, 'e'.repeat(64));
    const { build, calls } = fakeBuild(root);
    await prepareHost({
      root,
      registry: registry.url,
      cache: temporary(),
      build,
      log: quiet,
    });
    expect(calls).toEqual([
      `the native sources differ from ${here.package}@0.3.0's; built from source`,
    ]);
  });

  test('never takes a registry failure for an unpublished version', async () => {
    const root = packageCopy();
    const { build, calls } = fakeBuild(root);
    registry.failWith = 503;
    try {
      await expect(
        prepareHost({
          root,
          registry: registry.url,
          cache: temporary(),
          build,
          log: quiet,
        }),
      ).rejects.toMatchObject({
        code: 'selection-failed',
        message: expect.stringMatching(/HTTP 503/),
      });
      await expect(
        prepareHost({
          root,
          registry: 'http://127.0.0.1:1',
          cache: temporary(),
          build,
          log: quiet,
        }),
      ).rejects.toMatchObject({ code: 'selection-failed' });
    } finally {
      registry.failWith = undefined;
    }
    expect(calls).toEqual([]);
  });

  test('rejects a tarball that fails its integrity check', async () => {
    const root = packageCopy(undefined, '0.4.0');
    publish(root, undefined, '0.4.0');
    const key = `${here.package}@0.4.0`;
    const real = registry.versions.get(key)!;
    // The metadata's integrity is of these bytes; the tarball served differs.
    const original = registry.versions;
    registry.versions = new Map(original);
    const fetcher: typeof fetch = async (url, init) => {
      const response = await fetch(url, init);
      if (String(url).includes('/tarballs/'))
        return new Response(Buffer.concat([real, Buffer.from([0])]));
      return response;
    };
    await expect(
      prepareHost({
        root,
        registry: registry.url,
        cache: temporary(),
        build: fakeBuild(root).build,
        log: quiet,
        fetcher,
      }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/integrity/) });
    registry.versions = original;
  });

  test('uses a CI artifact only when it matches the checkout exactly', async () => {
    const root = packageCopy();
    const { fingerprint } = nativeInputs(root);
    const directory = temporary();
    artifact(directory, here, { sourceFingerprint: fingerprint });
    const prepared = await prepareHost({
      root,
      artifact: directory,
      commit: COMMIT,
      log: quiet,
    });
    expect(prepared).toMatchObject({
      mode: 'artifact',
      executable: join(directory, here.executable),
    });

    await expect(
      prepareHost({
        root,
        artifact: directory,
        commit: 'b'.repeat(40),
        log: quiet,
      }),
    ).rejects.toThrow(/built from a3f91c2d/);
    const other = temporary();
    artifact(other, here, { sourceFingerprint: 'e'.repeat(64) });
    await expect(
      prepareHost({ root, artifact: other, log: quiet }),
    ).rejects.toThrow(/other native sources/);
    writeFileSync(join(directory, here.executable), 'changed');
    await expect(
      prepareHost({ root, artifact: directory, log: quiet }),
    ).rejects.toThrow(/SHA-256/);
  });

  test('records the provenance it downloaded', async () => {
    const root = packageCopy(undefined, '0.5.0');
    publish(root, undefined, '0.5.0');
    const cache = temporary();
    await prepareHost({
      root,
      registry: registry.url,
      cache,
      build: fakeBuild(root).build,
      log: quiet,
    });
    const record = JSON.parse(
      readFileSync(
        join(
          cache,
          'vst3-host',
          'prebuilt',
          '0.5.0',
          here.target,
          PROVENANCE_FILE,
        ),
        'utf8',
      ),
    );
    expect(record.executable.sha256).toBe(
      sha256(Buffer.from(`#!/bin/sh\necho ${here.target}\n`)),
    );
  });
});
