// engine(): `node --test node/test/*.test.ts` (the package's `test`). The
// network is a fake fetch, the cache and packages temporary directories.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { gzipSync } from 'node:zlib';

import {
  localManifest,
  pack,
  plan,
} from '../../../.github/scripts/engine-prebuilts.mjs';
import { webInputs } from '../../scripts/engine-inputs.mjs';
import { withLock } from '../src/cache.ts';
import { type EngineContext, engine } from '../src/index.ts';
import { hostTarget } from '../src/targets.ts';
import { PROTOCOL_VERSION, webLicenses } from '../src/web.ts';

const work = mkdtempSync(join(tmpdir(), 'soundor-engine-node-'));
after(() => rmSync(work, { recursive: true, force: true }));
let counter = 0;
const fresh = (name: string) => {
  const path = join(work, `${name}-${++counter}`);
  mkdirSync(path, { recursive: true });
  return path;
};

const version = '0.2.1';
const commit = 'a3f91c2d'.padEnd(40, '0');
const webFingerprint = 'c'.repeat(64);
const sha256 = (data: Uint8Array) =>
  createHash('sha256').update(data).digest('hex');

/** A module exporting soundor_engine_protocol (returning <protocol>) and soundor_engine_create. */
function wasm(protocol = PROTOCOL_VERSION): Buffer {
  const name = (text: string) => [text.length, ...Buffer.from(text)];
  const exports = [
    2,
    ...name('soundor_engine_protocol'),
    0,
    0,
    ...name('soundor_engine_create'),
    0,
    1,
  ];
  return Buffer.from([
    ...[0, 0x61, 0x73, 0x6d, 1, 0, 0, 0],
    ...[1, 5, 1, 0x60, 0, 1, 0x7f], // () -> i32
    ...[3, 3, 2, 0, 0],
    ...[7, exports.length, ...exports],
    ...[10, 11, 2, 4, 0, 0x41, protocol, 0x0b, 4, 0, 0x41, 0, 0x0b],
  ]);
}

/** A gzipped ustar of <files> under <top>/. */
function tarGz(
  top: string,
  files: Record<string, Uint8Array | string>,
): Buffer {
  const blocks: Buffer[] = [];
  for (const [path, contents] of Object.entries(files)) {
    const data = Buffer.from(contents);
    const header = Buffer.alloc(512);
    header.write(`${top}/${path}`, 0, 100);
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
    header.write('00000000000\0', 136);
    header.fill(' ', 148, 156);
    header.write('0', 156);
    header.write('ustar\0', 257);
    header.write('00', 263);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

interface Release {
  manifest: Record<string, unknown>;
  archive: Buffer;
  url: string;
}

/** A published web artifact: its archive, and a manifest naming it. */
function webRelease(
  edit: {
    metadata?: (m: Record<string, any>) => Record<string, any>;
    module?: Buffer;
    protocol?: number;
    fingerprint?: string;
  } = {},
): Release {
  const module = edit.module ?? wasm();
  const top = `soundor-engine-${version}-web-release`;
  const metadata = (edit.metadata ?? ((m) => m))({
    format: 1,
    engine: {
      version,
      abiNamespace: 'v0_2_1',
      sourceCommit: commit,
      sourceFingerprint: edit.fingerprint ?? webFingerprint,
    },
    variant: 'release',
    configuration: 'Release',
    target: { name: 'web', os: 'web', architectures: ['wasm32'] },
    toolchain: { compiler: 'Emscripten', compilerVersion: '7.0.0' },
    protocol: edit.protocol ?? PROTOCOL_VERSION,
    files: {
      wasm: {
        path: 'soundor-core.wasm',
        sha256: sha256(module),
        size: module.length,
      },
    },
  });
  const archive = tarGz(top, {
    'soundor-engine.json': JSON.stringify(metadata),
    'soundor-core.wasm': module,
    'licenses/engine/LICENSE': 'MIT',
  });
  const url = `https://github.com/o/r/releases/download/t/${top}.tar.gz`;
  return {
    archive,
    url,
    manifest: manifest([
      {
        file: `${top}.tar.gz`,
        target: 'web',
        variant: 'release',
        sha256: sha256(archive),
        size: archive.length,
        url,
        sourceFingerprint: edit.fingerprint ?? webFingerprint,
        protocol: edit.protocol ?? PROTOCOL_VERSION,
      },
    ]),
  };
}

function manifest(artifacts: unknown[]): Record<string, unknown> {
  return {
    format: 1,
    engineVersion: version,
    abiNamespace: 'v0_2_1',
    sourceCommit: commit,
    sourceFingerprint: 'f'.repeat(64),
    revision: 1,
    tag: `engine-prebuilts-v${version}-a3f91c2d-r1`,
    artifacts,
  };
}

/** An installed @soundor/engine: its package.json and bundled manifest. */
function installed(value?: unknown): string {
  const root = fresh('installed');
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: '@soundor/engine', version }),
  );
  if (value !== undefined) {
    mkdirSync(join(root, 'artifacts'));
    writeFileSync(
      join(root, 'artifacts', 'manifest.json'),
      JSON.stringify(value),
    );
  }
  return root;
}

/** A minimal engine source checkout, enough for webInputs(). */
function checkout(): string {
  const root = installed();
  const write = (path: string, text: string) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write(
    'CMakeLists.txt',
    'if(EMSCRIPTEN)\n  add_subdirectory(wasm)\n  return()\nendif()\n',
  );
  write(
    'CMakePresets.json',
    JSON.stringify({ configurePresets: [{ name: 'wasm' }] }),
  );
  write('wasm/CMakeLists.txt', 'add_executable(soundor_wasm Engine.cpp)\n');
  write('wasm/Engine.cpp', 'int main() {}\n');
  write('wasm/emscripten.json', '{"version":"7.0.0"}');
  for (const file of [
    'SoundorAbi.cmake',
    'SoundorAbi.h.in',
    'SoundorCompilerOptions.cmake',
    'SoundorCoreSources.cmake',
    'SoundorDependencies.cmake',
    'SoundorYoga.cmake',
    'SoundorYogaPatch.cmake',
  ])
    write(`cmake/${file}`, '');
  return root;
}

/** A fetch serving <routes> (URL → bytes, or a status), counting requests. */
function network(routes: Record<string, Uint8Array | number | Error>) {
  const requests: string[] = [];
  const fetch = async (url: string) => {
    requests.push(url);
    const route = routes[url];
    if (route === undefined) return new Response('not found', { status: 404 });
    if (route instanceof Error) throw route;
    if (typeof route === 'number') return new Response('', { status: route });
    return new Response(new Uint8Array(route));
  };
  return { fetch, requests };
}

const offline = network({});
function context(extra: EngineContext = {}): EngineContext {
  return {
    cache: fresh('cache'),
    env: {},
    fetch: offline.fetch,
    log: () => {},
    buildWeb: () => assert.fail('nothing may be built'),
    ...extra,
  };
}

const rejects = (code: string, message: RegExp) => (error: unknown) => {
  const e = error as { name?: string; code?: string; message: string };
  assert.equal(e.name, 'SoundorEngineError');
  assert.equal(e.code, code, e.message);
  assert.match(e.message, message);
  return true;
};

describe('prebuilt web artifacts', () => {
  test('downloads, verifies and caches the published module', async () => {
    const release = webRelease();
    const net = network({ [release.url]: release.archive });
    const ctx = context({
      root: installed(release.manifest),
      fetch: net.fetch,
    });
    const artifact = await engine({ target: 'web' }, ctx);
    assert.equal(artifact.target, 'web');
    assert.equal(artifact.mode, 'prebuilt');
    assert.equal(artifact.sourceFingerprint, webFingerprint);
    assert.deepEqual(readFileSync(artifact.files.wasm), wasm());
    assert.ok(
      artifact.files.wasm.startsWith(join(ctx.cache!, 'engine-prebuilts')),
    );
    assert.deepEqual(net.requests, [release.url]);
    // Nothing partial is left beside it.
    assert.deepEqual(
      readdirSync(join(ctx.cache!, 'engine-prebuilts')).filter((name) =>
        /part|lock/.test(name),
      ),
      [],
    );
  });

  test('reuses a valid cached copy without the network, offline too', async () => {
    const release = webRelease();
    const net = network({ [release.url]: release.archive });
    const ctx = context({
      root: installed(release.manifest),
      fetch: net.fetch,
    });
    const first = await engine({ target: 'web' }, ctx);
    const again = await engine(
      { target: 'web' },
      { ...ctx, fetch: offline.fetch },
    );
    assert.equal(again.files.wasm, first.files.wasm);
    assert.equal(net.requests.length, 1);
    assert.equal(offline.requests.length, 0);
  });

  test('replaces a damaged cached copy from the verified archive', async () => {
    const release = webRelease();
    const net = network({ [release.url]: release.archive });
    const ctx = context({
      root: installed(release.manifest),
      fetch: net.fetch,
    });
    const first = await engine({ target: 'web' }, ctx);
    writeFileSync(first.files.wasm, wasm(9));
    const again = await engine({ target: 'web' }, ctx);
    assert.deepEqual(readFileSync(again.files.wasm), wasm());
    assert.equal(net.requests.length, 1);
  });

  test('replaces an interrupted extraction and a corrupt cached archive', async () => {
    const release = webRelease();
    const net = network({ [release.url]: release.archive });
    const ctx = context({
      root: installed(release.manifest),
      fetch: net.fetch,
    });
    const digest = sha256(release.archive);
    const directory = join(ctx.cache!, 'engine-prebuilts');
    mkdirSync(join(directory, digest), { recursive: true }); // never marked
    writeFileSync(join(directory, `${digest}.tar.gz`), 'truncated');
    const artifact = await engine({ target: 'web' }, ctx);
    assert.deepEqual(readFileSync(artifact.files.wasm), wasm());
    assert.equal(net.requests.length, 1);
  });

  test('concurrent preparations download once and agree', async () => {
    const release = webRelease();
    let requests = 0;
    const fetch = async () => {
      requests++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return new Response(new Uint8Array(release.archive));
    };
    const ctx = context({ root: installed(release.manifest), fetch });
    const all = await Promise.all(
      Array.from({ length: 6 }, () => engine({ target: 'web' }, ctx)),
    );
    assert.equal(requests, 1);
    assert.equal(new Set(all.map((a) => a.files.wasm)).size, 1);
  });

  test('a checksum mismatch is an error, and nothing is cached', async () => {
    const release = webRelease();
    const net = network({ [release.url]: Buffer.from('not the archive') });
    const ctx = context({
      root: installed(release.manifest),
      fetch: net.fetch,
    });
    await assert.rejects(
      engine({ target: 'web' }, ctx),
      rejects('download', /not the archive the manifest names/),
    );
    assert.deepEqual(readdirSync(join(ctx.cache!, 'engine-prebuilts')), []);
  });

  for (const [name, route] of [
    ['an HTTP error', 503],
    ['a network failure', new Error('ECONNRESET')],
  ] as const)
    test(`${name} is an error, never a reason to build`, async () => {
      const release = webRelease();
      const net = network({ [release.url]: route });
      const ctx = context({
        root: installed(release.manifest),
        fetch: net.fetch,
      });
      await assert.rejects(
        engine({ target: 'web' }, ctx),
        rejects('download', /Downloading .* failed/),
      );
    });

  test('an invalid manifest is an error', async () => {
    const release = webRelease();
    const broken = {
      ...release.manifest,
      artifacts: [{ file: 'x', target: 'web' }],
    };
    await assert.rejects(
      engine({ target: 'web' }, context({ root: installed(broken) })),
      rejects('manifest', /lacks its file/),
    );
    await assert.rejects(
      engine({ target: 'web' }, context({ root: installed({ format: 2 }) })),
      rejects('manifest', /Invalid prebuilt manifest/),
    );
  });

  test("another version's manifest is an error", async () => {
    const release = webRelease();
    await assert.rejects(
      engine(
        { target: 'web' },
        context({
          root: installed({ ...release.manifest, engineVersion: '0.2.0' }),
        }),
      ),
      rejects(
        'manifest',
        /Invalid prebuilt manifest for @soundor\/engine 0\.2\.1/,
      ),
    );
  });

  test('an archive of another target, commit or ABI is rejected', async () => {
    for (const [metadata, message] of [
      [
        (m: Record<string, any>) => ({
          ...m,
          target: { ...m.target, name: 'linux-x64' },
        }),
        /target.name/,
      ],
      [
        (m: Record<string, any>) => ({
          ...m,
          engine: { ...m.engine, sourceCommit: 'b'.repeat(40) },
        }),
        /sourceCommit/,
      ],
      [
        (m: Record<string, any>) => ({
          ...m,
          engine: { ...m.engine, abiNamespace: 'v0_2_0' },
        }),
        /abiNamespace/,
      ],
    ] as const) {
      const release = webRelease({ metadata });
      const net = network({ [release.url]: release.archive });
      await assert.rejects(
        engine(
          { target: 'web' },
          context({ root: installed(release.manifest), fetch: net.fetch }),
        ),
        rejects('artifact', message),
      );
    }
  });

  test('a module of another protocol is rejected before it is downloaded', async () => {
    const release = webRelease({
      protocol: PROTOCOL_VERSION + 1,
      module: wasm(PROTOCOL_VERSION + 1),
    });
    const net = network({ [release.url]: release.archive });
    await assert.rejects(
      engine(
        { target: 'web' },
        context({ root: installed(release.manifest), fetch: net.fetch }),
      ),
      rejects('artifact', /speaks protocol 2; this @soundor\/engine speaks 1/),
    );
    assert.equal(net.requests.length, 0);
  });

  test('a module whose metadata lies about its protocol is rejected', async () => {
    const release = webRelease({ module: wasm(PROTOCOL_VERSION + 1) });
    const net = network({ [release.url]: release.archive });
    await assert.rejects(
      engine(
        { target: 'web' },
        context({ root: installed(release.manifest), fetch: net.fetch }),
      ),
      rejects('artifact', /speaks protocol 2/),
    );
  });

  test('published mode fails when the release has no web artifact', async () => {
    const root = installed(manifest([]));
    await assert.rejects(
      engine({ target: 'web', mode: 'published' }, context({ root })),
      rejects('unavailable', /has no web artifact/),
    );
    // An installed package cannot build either.
    await assert.rejects(
      engine({ target: 'web' }, context({ root })),
      rejects('unavailable', /cannot build/),
    );
  });

  test('the staged release, as engine-prebuilts.mjs packs it, works', async () => {
    const directory = fresh('stage');
    const module = wasm();
    writeFileSync(join(directory, 'soundor-core.wasm'), module);
    for (const component of ['engine', 'yoga', 'emscripten']) {
      mkdirSync(join(directory, 'licenses', component), { recursive: true });
      writeFileSync(join(directory, 'licenses', component, 'LICENSE'), 'MIT');
    }
    writeFileSync(
      join(directory, 'soundor-engine.json'),
      JSON.stringify({
        format: 1,
        engine: {
          version,
          abiNamespace: 'v0_2_1',
          sourceCommit: commit,
          sourceFingerprint: webFingerprint,
        },
        variant: 'release',
        configuration: 'Release',
        target: { name: 'web', os: 'web', architectures: ['wasm32'] },
        toolchain: { compiler: 'Emscripten', compilerVersion: '7.0.0' },
        protocol: PROTOCOL_VERSION,
        files: {
          wasm: {
            path: 'soundor-core.wasm',
            sha256: sha256(module),
            size: module.length,
          },
        },
      }),
    );
    const archives = fresh('archives');
    await pack(directory, archives, {
      ...plan({ version, commit, revision: 1 }),
      target: 'web',
    });
    const path = join(fresh('manifest'), 'manifest.json');
    writeFileSync(path, JSON.stringify(localManifest(archives, commit)));
    const artifact = await engine(
      { target: 'web', mode: 'published' },
      context({ root: installed(), env: { SOUNDOR_ENGINE_MANIFEST: path } }),
    );
    assert.equal(artifact.mode, 'prebuilt');
    assert.deepEqual(readFileSync(artifact.files.wasm), module);
  });
});

describe('the npm manifest', () => {
  /** The registry's metadata and tarball of @soundor/engine <version>, carrying <value>. */
  function registry(value: unknown) {
    const tarball = tarGz('package', {
      'package.json': JSON.stringify({ name: '@soundor/engine', version }),
      'artifacts/manifest.json': JSON.stringify(value),
    });
    const url = `https://registry.npmjs.org/@soundor/engine/-/engine-${version}.tgz`;
    return {
      [`https://registry.npmjs.org/@soundor%2fengine/${version}`]: Buffer.from(
        JSON.stringify({
          name: '@soundor/engine',
          version,
          dist: {
            tarball: url,
            integrity: `sha512-${createHash('sha512').update(tarball).digest('base64')}`,
          },
        }),
      ),
      [url]: tarball,
    };
  }

  test('a checkout reads, verifies and caches the published manifest, then works offline', async () => {
    const root = checkout();
    const fingerprint = webInputs(root).fingerprint;
    const release = webRelease({ fingerprint });
    const net = network({
      ...registry(release.manifest),
      [release.url]: release.archive,
    });
    const ctx = context({ root, fetch: net.fetch });
    const artifact = await engine({ target: 'web' }, ctx);
    assert.equal(artifact.mode, 'prebuilt');
    assert.equal(net.requests.length, 3);
    const again = await engine(
      { target: 'web' },
      { ...ctx, fetch: offline.fetch },
    );
    assert.equal(again.files.wasm, artifact.files.wasm);
  });

  test('an unpublished version builds in a checkout, and fails in published mode', async () => {
    const root = checkout();
    let built = 0;
    const module = join(fresh('built'), 'soundor-core.wasm');
    writeFileSync(module, wasm());
    const ctx = context({
      root,
      fetch: network({}).fetch, // the registry: 404
      buildWeb: async () => {
        built++;
        return { wasm: module, fingerprint: webInputs(root).fingerprint };
      },
    });
    const artifact = await engine({ target: 'web' }, ctx);
    assert.equal(artifact.mode, 'source');
    assert.match(artifact.reason, /is not published/);
    assert.equal(built, 1);
    await assert.rejects(
      engine({ target: 'web', mode: 'published' }, ctx),
      rejects('unavailable', /is not published/),
    );
  });

  test('a registry failure is an error, not "unpublished"', async () => {
    const ctx = context({
      root: checkout(),
      fetch: network({
        [`https://registry.npmjs.org/@soundor%2fengine/${version}`]: 500,
      }).fetch,
    });
    await assert.rejects(
      engine({ target: 'web' }, ctx),
      rejects('manifest', /HTTP 500/),
    );
  });
});

describe('source checkouts', () => {
  test('sources that differ from the release are built; published mode refuses', async () => {
    const root = checkout();
    const release = webRelease(); // another fingerprint
    const path = join(fresh('manifest'), 'manifest.json');
    writeFileSync(path, JSON.stringify(release.manifest));
    const module = join(fresh('built'), 'soundor-core.wasm');
    writeFileSync(module, wasm());
    let built = 0;
    const ctx = context({
      root,
      fetch: network({
        ...{},
        [`https://registry.npmjs.org/@soundor%2fengine/${version}`]: 404,
      }).fetch,
      buildWeb: async () => {
        built++;
        return { wasm: module, fingerprint: webInputs(root).fingerprint };
      },
    });
    // Bundled, as an installed package carries it: not explicit, so built around.
    mkdirSync(join(root, 'artifacts'));
    cpSync(path, join(root, 'artifacts', 'manifest.json'));
    const artifact = await engine({ target: 'web' }, ctx);
    assert.equal(artifact.mode, 'source');
    assert.match(artifact.reason, /sources differ/);
    assert.equal(built, 1);
    await assert.rejects(
      engine({ target: 'web', mode: 'published' }, ctx),
      rejects('unavailable', /sources differ/),
    );
    // An explicit manifest must match: never built around.
    await assert.rejects(
      engine(
        { target: 'web' },
        { ...ctx, env: { SOUNDOR_ENGINE_MANIFEST: path } },
      ),
      rejects('unavailable', /sources differ/),
    );
    assert.equal(built, 1);
  });

  test('a local build of these sources is reused; an edit makes it stale', async () => {
    const root = checkout();
    const stage = join(root, 'build', 'wasm', 'stage');
    mkdirSync(stage, { recursive: true });
    const module = wasm();
    writeFileSync(join(stage, 'soundor-core.wasm'), module);
    writeFileSync(
      join(stage, 'soundor-engine.json'),
      JSON.stringify({
        format: 1,
        engine: { version, sourceFingerprint: webInputs(root).fingerprint },
        files: {
          wasm: {
            path: 'soundor-core.wasm',
            sha256: sha256(module),
            size: module.length,
          },
        },
      }),
    );
    let built = 0;
    const ctx = context({
      root,
      buildWeb: async () => {
        built++;
        return {
          wasm: join(stage, 'soundor-core.wasm'),
          fingerprint: webInputs(root).fingerprint,
        };
      },
    });
    const artifact = await engine({ target: 'web' }, ctx);
    assert.equal(artifact.mode, 'source');
    assert.match(artifact.reason, /local build/);
    assert.equal(artifact.files.wasm, join(stage, 'soundor-core.wasm'));
    assert.equal(built, 0);
    // An edit to the core: the stage no longer matches, the release is
    // consulted (unpublished here) and the sources built.
    writeFileSync(
      join(root, 'wasm', 'Engine.cpp'),
      'int main() { return 1; }\n',
    );
    assert.match(
      (await engine({ target: 'web' }, ctx)).reason,
      /not published; built from source/,
    );
    assert.equal(built, 1);
  });

  test('source mode builds; an installed package cannot', async () => {
    const root = checkout();
    const module = join(fresh('built'), 'soundor-core.wasm');
    writeFileSync(module, wasm());
    let built = 0;
    const artifact = await engine(
      { target: 'web', mode: 'source' },
      context({
        root,
        buildWeb: async () => {
          built++;
          return { wasm: module, fingerprint: 'e'.repeat(64) };
        },
      }),
    );
    assert.equal(artifact.mode, 'source');
    assert.equal(built, 1);
    await assert.rejects(
      engine({ target: 'web', mode: 'source' }, context({ root: installed() })),
      rejects('unavailable', /cannot build/),
    );
  });

  test('source mode without Emscripten says how to get it', async () => {
    const ctx = context({ root: checkout() });
    delete ctx.buildWeb;
    await assert.rejects(
      engine({ target: 'web', mode: 'source' }, ctx),
      rejects('build', /needs Emscripten 7\.0\.0.*EMSDK/s),
    );
  });
});

describe('SOUNDOR_ENGINE_WASM', () => {
  test('names the module to use, checked', async () => {
    const path = join(fresh('override'), 'soundor-core.wasm');
    writeFileSync(path, wasm());
    const artifact = await engine(
      { target: 'web' },
      context({ root: installed(), env: { SOUNDOR_ENGINE_WASM: path } }),
    );
    assert.equal(artifact.mode, 'override');
    assert.equal(artifact.files.wasm, path);
  });

  test('rejects a missing file, another file and another protocol', async () => {
    const directory = fresh('override');
    const cases: [string, Uint8Array | undefined, RegExp][] = [
      ['missing.wasm', undefined, /cannot be read/],
      [
        'text.wasm',
        Buffer.from('hello'),
        /is not the Soundor engine's WebAssembly/,
      ],
      ['other.wasm', wasm(PROTOCOL_VERSION + 1), /speaks protocol 2/],
    ];
    for (const [name, contents, message] of cases) {
      const path = join(directory, name);
      if (contents) writeFileSync(path, contents);
      await assert.rejects(
        engine(
          { target: 'web' },
          context({ root: installed(), env: { SOUNDOR_ENGINE_WASM: path } }),
        ),
        rejects('artifact', message),
      );
    }
  });
});

describe('native targets', () => {
  function nativeRelease(target: string, variant: string) {
    const top = `soundor-engine-${version}-${target}-${variant}`;
    const metadata = {
      format: 1,
      engine: {
        version,
        abiNamespace: 'v0_2_1',
        sourceCommit: commit,
        sourceFingerprint: 'f'.repeat(64),
      },
      variant,
      configuration: variant.startsWith('debug') ? 'Debug' : 'Release',
      target: {
        name: target,
        os: target.split('-')[0],
        architectures: ['x64'],
      },
      toolchain: { compiler: 'MSVC', compilerVersion: '19.44' },
      hermes: { compiler: 'hermes/bin/hermesc' },
      link: {
        engine: ['lib/soundor_runtime.lib'],
        hermes: ['hermes/lib/hermes.lib'],
        skia: ['skia/lib/skia.lib'],
        angle: ['angle/lib/angle.lib'],
        system: ['d3d11', 'user32.lib'],
        frameworks: [],
      },
    };
    const archive = tarGz(top, {
      'soundor-engine.json': JSON.stringify(metadata),
      'lib/soundor_runtime.lib': 'a',
      'hermes/lib/hermes.lib': 'b',
      'hermes/include/hermes/hermes.h': '',
      'skia/lib/skia.lib': 'c',
      'angle/lib/angle.lib': 'd',
      'angle/include/EGL/egl.h': '',
      'include/soundor/Abi.h': '',
      'hermes/bin/hermesc': 'e',
    });
    const url = `https://github.com/o/r/releases/download/t/${top}.tar.gz`;
    return {
      url,
      archive,
      entry: {
        file: `${top}.tar.gz`,
        target,
        variant,
        sha256: sha256(archive),
        size: archive.length,
        url,
      },
    };
  }

  test('prepares a native archive with what a linker needs', async () => {
    const release = nativeRelease('windows-x64', 'release-static');
    const ctx = context({
      root: installed(manifest([release.entry])),
      fetch: network({ [release.url]: release.archive }).fetch,
    });
    const artifact = await engine(
      { target: 'windows-x64', variant: 'release-static' },
      ctx,
    );
    assert.equal(artifact.mode, 'prebuilt');
    const directory = artifact.directory;
    assert.deepEqual(artifact.libraries, [
      join(directory, 'lib/soundor_runtime.lib'),
      join(directory, 'hermes/lib/hermes.lib'),
      join(directory, 'skia/lib/skia.lib'),
      join(directory, 'angle/lib/angle.lib'),
    ]);
    assert.deepEqual(artifact.includeDirs, [
      join(directory, 'include'),
      join(directory, 'hermes/include'),
      join(directory, 'angle/include'),
    ]);
    assert.deepEqual(artifact.linkFlags, ['d3d11.lib', 'user32.lib']);
    assert.equal(artifact.hermesc, join(directory, 'hermes/bin/hermesc'));
    assert.ok(existsSync(join(directory, 'soundor-engine.json')));
  });

  test('defaults to the release archive, and rejects what does not exist', async () => {
    const release = nativeRelease('linux-x64', 'release');
    const root = installed(manifest([release.entry]));
    const fetch = network({ [release.url]: release.archive }).fetch;
    assert.equal(
      (await engine({ target: 'linux-x64' }, context({ root, fetch }))).variant,
      'release',
    );
    await assert.rejects(
      engine(
        { target: 'linux-x64', variant: 'debug' },
        context({ root, fetch }),
      ),
      rejects('unavailable', /no debug linux-x64 artifact/),
    );
    await assert.rejects(
      engine(
        { target: 'linux-x64', variant: 'release-static' },
        context({ root }),
      ),
      rejects('invalid-options', /Windows/),
    );
    await assert.rejects(
      engine({ target: 'linux-arm64' } as never, context({ root })),
      rejects(
        'invalid-options',
        /target is web, linux-x64, windows-x64 or macos-universal/,
      ),
    );
    await assert.rejects(
      engine({ target: 'web', mode: 'fast' } as never, context({ root })),
      rejects('invalid-options', /mode/),
    );
  });

  test('shares its cache layout with CMake: <sha256>/ marked verified', async () => {
    const release = nativeRelease('linux-x64', 'release');
    const ctx = context({
      root: installed(manifest([release.entry])),
      fetch: network({ [release.url]: release.archive }).fetch,
    });
    await engine({ target: 'linux-x64' }, ctx);
    const extracted = join(
      ctx.cache!,
      'engine-prebuilts',
      release.entry.sha256,
    );
    assert.equal(
      readFileSync(join(extracted, '.soundor-verified'), 'utf8'),
      `${release.entry.sha256}\n`,
    );
    assert.ok(existsSync(`${extracted}.tar.gz`));
  });
});

describe('native source builds of an installed package', () => {
  const target = hostTarget();

  /** A staged engine, as soundor_engine_stage lays one out. */
  function stage(directory: string): string {
    const root = join(directory, 'stage');
    const write = (path: string, text: string) => {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    write(
      'soundor-engine.json',
      JSON.stringify({
        format: 1,
        engine: {
          version,
          abiNamespace: 'v',
          sourceCommit: null,
          sourceFingerprint: 'd'.repeat(64),
        },
        variant: 'release',
        configuration: 'Release',
        target: { name: target, os: 'x', architectures: ['x64'] },
        toolchain: { compiler: 'Clang', compilerVersion: '18' },
        hermes: { compiler: 'hermes/bin/hermesc' },
        link: { engine: ['lib/libsoundor_runtime.a'], system: [] },
      }),
    );
    write('lib/libsoundor_runtime.a', 'a');
    return root;
  }

  test(
    'build into the cache only in mode "source"',
    {
      skip: target === undefined,
    },
    async () => {
      const built: (string | undefined)[] = [];
      const ctx = context({
        root: installed(),
        buildNative: (_variant, directory) => {
          built.push(directory);
          return stage(directory!);
        },
      });
      const artifact = await engine({ target: target!, mode: 'source' }, ctx);
      assert.equal(artifact.mode, 'source');
      assert.equal(artifact.sourceFingerprint, 'd'.repeat(64));
      assert.deepEqual(built, [
        join(ctx.cache!, 'engine-source', version, `${target}-release`),
      ]);
      assert.ok(
        artifact.libraries[0]!.startsWith(join(ctx.cache!, 'engine-source')),
      );
    },
  );

  test(
    'an unpublished installed version never builds by itself',
    {
      skip: target === undefined,
    },
    async () => {
      await assert.rejects(
        engine(
          { target: target! },
          context({
            root: installed(),
            fetch: network({}).fetch,
            buildNative: () => assert.fail('nothing may be built'),
          }),
        ),
        rejects('unavailable', /only in mode "source"/),
      );
    },
  );
});

describe('locks', () => {
  test('one holder at a time', async () => {
    const lock = join(fresh('lock'), 'build.lock');
    let inside = 0;
    let most = 0;
    await Promise.all(
      Array.from({ length: 5 }, () =>
        withLock(lock, async () => {
          most = Math.max(most, ++inside);
          await new Promise((resolve) => setTimeout(resolve, 20));
          inside--;
        }),
      ),
    );
    assert.equal(most, 1);
    assert.ok(!existsSync(lock));
  });

  test('a lock whose process is gone is taken over', async () => {
    const lock = join(fresh('lock'), 'build.lock');
    mkdirSync(lock);
    // A process id that cannot be running.
    writeFileSync(
      join(lock, 'owner.json'),
      JSON.stringify({
        pid: 2 ** 22 + 1,
        host: hostname(),
      }),
    );
    assert.equal(
      await withLock(lock, () => 'taken', { timeout: 2000 }),
      'taken',
    );
  });
});

describe("the WebAssembly core's notices", () => {
  test('are the engine, Yoga and Emscripten, from the package', () => {
    const root = join(import.meta.dirname, '..', '..');
    const licenses = webLicenses(root);
    assert.deepEqual(
      licenses.map((license) => [license.name, license.license]),
      [
        ['engine', 'MIT'],
        ['yoga', 'MIT'],
        ['emscripten', '(MIT OR NCSA) AND MIT'],
      ],
    );
    assert.deepEqual(
      licenses.find((license) => license.name === 'emscripten')!.files,
      [
        join(root, 'licenses', 'emscripten', 'LICENSE'),
        join(root, 'licenses', 'emscripten', 'musl-COPYRIGHT'),
      ],
    );
  });
});
