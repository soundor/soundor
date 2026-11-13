import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { engineInputs, loweringInputs } from '../../scripts/engine-inputs.mjs';
import {
  packageManifest,
  releasedManifest,
  selectEngine,
} from '../../scripts/engine-selection.mjs';

const work = mkdtempSync(join(tmpdir(), 'soundor-engine-selection-'));
after(() => rmSync(work, { recursive: true, force: true }));
const engine = fileURLToPath(new URL('../..', import.meta.url));
function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}
function fixture() {
  const root = mkdtempSync(join(work, 'engine-'));
  for (const directory of ['src', 'include', 'cmake', 'scripts'])
    mkdirSync(join(root, directory));
  write(
    join(root, 'package.json'),
    JSON.stringify({
      name: '@soundor/engine',
      version: '1.0.0',
      dependencies: {},
    }),
  );
  write(join(root, 'src/engine.cpp'), 'original\n');
  write(join(root, 'include/engine.h'), 'header\n');
  write(join(root, 'CMakeLists.txt'), 'build\n');
  return root;
}
function manifest(root) {
  return {
    format: 1,
    engineVersion: '1.0.0',
    sourceFingerprint: engineInputs(root).fingerprint,
    artifacts: [],
  };
}
function tar(value) {
  const bytes = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(512);
  header.write('package/artifacts/manifest.json');
  header.write(bytes.length.toString(8).padStart(11, '0'), 124);
  header[156] = 48;
  return gzipSync(
    Buffer.concat([
      header,
      bytes,
      Buffer.alloc((512 - (bytes.length % 512)) % 512),
      Buffer.alloc(1024),
    ]),
  );
}

test('identity excludes docs, tests and unrelated lockfile changes but sees dirty native inputs', () => {
  const root = fixture();
  const before = engineInputs(root).fingerprint;
  const clone = join(work, 'relocated-engine');
  cpSync(root, clone, { recursive: true });
  assert.equal(
    engineInputs(clone).fingerprint,
    before,
    'identity is independent of checkout path',
  );
  for (const path of ['README.md', 'tests/test.cpp', 'pnpm-lock.yaml'])
    write(join(root, path), 'unrelated');
  assert.equal(engineInputs(root).fingerprint, before);
  write(join(root, 'src/engine.cpp'), 'original\r\n');
  assert.equal(
    engineInputs(root).fingerprint,
    before,
    'Windows checkout line endings',
  );
  write(join(root, 'include/new.h'), 'untracked header');
  assert.notEqual(engineInputs(root).fingerprint, before);
  rmSync(join(root, 'include/new.h'));
  assert.equal(engineInputs(root).fingerprint, before);
  rmSync(join(root, 'src/engine.cpp'));
  assert.notEqual(engineInputs(root).fingerprint, before);
});

test('identity normalizes CRLF in generated includes, IDL and embedded documentation', () => {
  for (const path of ['src/generated.inc', 'src/webgl.idl', 'src/README.md']) {
    const root = fixture();
    write(join(root, path), 'first line\nsecond line\n');
    const before = engineInputs(root).fingerprint;
    write(join(root, path), 'first line\r\nsecond line\r\n');
    assert.equal(engineInputs(root).fingerprint, before, path);
    write(join(root, path), 'changed line\nsecond line\n');
    assert.notEqual(engineInputs(root).fingerprint, before, path);
  }
});

test('identity preserves exact bytes for binary inputs', () => {
  const root = fixture();
  const path = join(root, 'src/resource.bin');
  write(path, Buffer.from([0xff, 0x0d, 0x0a, 0x00]));
  const before = engineInputs(root).fingerprint;
  write(path, Buffer.from([0xff, 0x0a, 0x00]));
  assert.notEqual(engineInputs(root).fingerprint, before);
});

test('installed lowering dependencies contribute their transitive versions', () => {
  const root = fixture();
  write(
    join(root, 'package.json'),
    JSON.stringify({ version: '1.0.0', dependencies: { lowering: '*' } }),
  );
  write(
    join(root, 'node_modules/lowering/package.json'),
    JSON.stringify({
      name: 'lowering',
      version: '1.0.0',
      dependencies: { helper: '*' },
    }),
  );
  const helper = join(root, 'node_modules/helper/package.json');
  write(
    helper,
    JSON.stringify({ name: 'helper', version: '1.0.0', exports: './index.js' }),
  );
  const before = engineInputs(root).fingerprint;
  write(
    helper,
    JSON.stringify({ name: 'helper', version: '1.0.1', exports: './index.js' }),
  );
  assert.notEqual(engineInputs(root).fingerprint, before);
});

test('workspace identity tracks Babel build dependencies but ignores unrelated dev tools', () => {
  const root = fixture();
  write(
    join(root, 'package.json'),
    JSON.stringify({
      version: '1.0.0',
      devDependencies: { '@babel/transform': '*', testRunner: '*' },
    }),
  );
  const plugin = join(root, 'node_modules/@babel/transform/package.json');
  write(plugin, JSON.stringify({ name: '@babel/transform', version: '1.0.0' }));
  const before = engineInputs(root).fingerprint;
  write(
    join(root, 'node_modules/testRunner/package.json'),
    JSON.stringify({ version: '2.0.0' }),
  );
  assert.equal(engineInputs(root).fingerprint, before);
  write(plugin, JSON.stringify({ name: '@babel/transform', version: '1.0.1' }));
  assert.notEqual(engineInputs(root).fingerprint, before);
});

test('bundled lowering identity survives transitive dependency drift on fresh installs', async () => {
  const root = fixture();
  write(
    join(root, 'package.json'),
    JSON.stringify({ version: '1.0.0', dependencies: { lowering: '*' } }),
  );
  const dependency = join(root, 'node_modules/lowering/package.json');
  write(dependency, JSON.stringify({ name: 'lowering', version: '1.0.0' }));
  const before = engineInputs(root).fingerprint;
  write(
    join(root, 'dist/lowering-inputs.json'),
    JSON.stringify(loweringInputs(root).dependencies),
  );
  write(join(root, 'dist/native-module.mjs'), 'export const bundled = true;');
  write(join(root, 'artifacts/manifest.json'), JSON.stringify(manifest(root)));
  assert.equal(engineInputs(root).fingerprint, before);
  write(dependency, JSON.stringify({ name: 'lowering', version: '1.1.0' }));
  assert.equal(engineInputs(root).fingerprint, before);
  assert.equal((await selectEngine(root, work)).mode, 'prebuilt');
  rmSync(join(root, 'node_modules'), { recursive: true });
  assert.equal(engineInputs(root).fingerprint, before);
  assert.equal((await selectEngine(root, work)).mode, 'prebuilt');
  write(join(root, 'src/engine.cpp'), 'edited');
  assert.equal((await selectEngine(root, work)).mode, 'source');
});

test('workspace lowering ignores a stale bundled graph', () => {
  const workspace = mkdtempSync(join(work, 'workspace-'));
  write(join(workspace, 'pnpm-workspace.yaml'), 'packages: []');
  const root = join(workspace, 'engines/engine');
  cpSync(fixture(), root, { recursive: true });
  write(
    join(root, 'dist/lowering-inputs.json'),
    JSON.stringify([['@soundor/engine', ['stale=dependency@1.0.0']]]),
  );
  assert.deepEqual(loweringInputs(root).dependencies, [
    ['@soundor/engine', []],
  ]);
});

test('CMake selection uses matching manifests offline and selects source for edits and old releases', async () => {
  const root = fixture();
  const path = join(root, 'artifacts/manifest.json');
  const value = manifest(root);
  write(path, JSON.stringify(value));
  const fetcher = () => {
    throw new Error('must remain offline');
  };
  assert.equal((await selectEngine(root, work, { fetcher })).mode, 'prebuilt');
  write(join(root, 'src/engine.cpp'), 'edited');
  assert.equal((await selectEngine(root, work, { fetcher })).mode, 'source');
  await assert.rejects(
    selectEngine(root, work, { manifest: path }),
    /explicitly supplied/,
  );
  delete value.sourceFingerprint;
  write(path, JSON.stringify(value));
  assert.equal((await selectEngine(root, work, { fetcher })).mode, 'source');
});

test('unpublished versions select source; network failures do not silently compile', async () => {
  const root = fixture();
  const cache = join(root, 'cache');
  assert.equal(
    (
      await selectEngine(root, cache, {
        fetcher: async () => new Response('', { status: 404 }),
      })
    ).mode,
    'source',
  );
  await assert.rejects(
    selectEngine(root, cache, {
      fetcher: async () => {
        throw new Error('offline');
      },
    }),
    /offline/,
  );
});

test('workspace metadata is fetched by exact npm version, integrity checked and cached', async () => {
  const root = fixture();
  const cache = join(root, 'cache');
  const value = manifest(root);
  const bytes = tar(value);
  assert.deepEqual(packageManifest(bytes), value);
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    return calls.length === 1
      ? Response.json({
          name: '@soundor/engine',
          version: '1.0.0',
          dist: {
            tarball: 'https://registry.npmjs.org/engine.tgz',
            integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
          },
        })
      : new Response(bytes);
  };
  assert.equal((await selectEngine(root, cache, { fetcher })).mode, 'prebuilt');
  assert.equal(calls[0], 'https://registry.npmjs.org/@soundor%2fengine/1.0.0');
  await releasedManifest(root, cache, () => {
    throw new Error('cached metadata must work offline');
  });
  assert.equal(calls.length, 2);
  rmSync(cache, { recursive: true });
  let count = 0;
  await assert.rejects(
    releasedManifest(root, cache, async () =>
      ++count === 1
        ? Response.json({
            name: '@soundor/engine',
            version: '1.0.0',
            dist: {
              tarball: 'https://registry.npmjs.org/engine.tgz',
              integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
            },
          })
        : new Response(bytes),
    ),
    /integrity check/,
  );
});

test('CMake reselects when native inputs change in an existing build tree', () => {
  const root = fixture();
  for (const file of ['engine-inputs.mjs', 'engine-selection.mjs'])
    cpSync(join(engine, 'scripts', file), join(root, 'scripts', file));
  write(join(root, 'artifacts/manifest.json'), JSON.stringify(manifest(root)));
  const project = join(root, 'consumer');
  write(
    join(project, 'CMakeLists.txt'),
    `cmake_minimum_required(VERSION 3.25)\nproject(Selection NONE)\nset(SoundorEngine_SOURCE_DIR "${root.replaceAll('\\', '/')}")\nset(SOUNDOR_ENGINE_VERSION 1.0.0)\nlist(APPEND CMAKE_MODULE_PATH "${join(engine, 'cmake').replaceAll('\\', '/')}")\ninclude(SoundorEngineSelect)\nfile(WRITE "\u0024{CMAKE_BINARY_DIR}/selected.txt" "\u0024{soundor_engine_selected_mode}")\n`,
  );
  const build = join(root, 'build');
  execFileSync('cmake', ['-S', project, '-B', build], { stdio: 'pipe' });
  assert.equal(readFileSync(join(build, 'selected.txt'), 'utf8'), 'prebuilt');
  write(join(root, 'include/engine.h'), 'changed header');
  execFileSync('cmake', ['--build', build], { stdio: 'pipe' });
  assert.equal(readFileSync(join(build, 'selected.txt'), 'utf8'), 'source');
  write(join(root, 'include/engine.h'), 'header\n');
  execFileSync('cmake', ['--build', build], { stdio: 'pipe' });
  assert.equal(readFileSync(join(build, 'selected.txt'), 'utf8'), 'prebuilt');
  write(join(root, 'include/new.h'), 'new untracked input');
  execFileSync('cmake', ['--build', build], { stdio: 'pipe' });
  assert.equal(readFileSync(join(build, 'selected.txt'), 'utf8'), 'source');
});
