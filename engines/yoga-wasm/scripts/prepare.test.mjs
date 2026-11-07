import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';

import { yogaPin } from './inputs.mjs';
import {
  moduleMode,
  publishedModule,
  publishedProblem,
  readTarball,
  soundorCache,
} from './prepare.mjs';

function tar(files) {
  const blocks = [];
  for (const [name, content] of Object.entries(files)) {
    const header = Buffer.alloc(512);
    header.write(name, 0);
    header.write(`${content.length.toString(8).padStart(11, '0')}\0`, 124);
    header[156] = 48;
    blocks.push(
      header,
      content,
      Buffer.alloc((512 - (content.length % 512)) % 512),
    );
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

const FINGERPRINT = 'f'.repeat(64);
const MODULE = Buffer.from('the module');

// A registry serving one version of the package.
function registry({ fingerprint = FINGERPRINT, integrity } = {}) {
  const archive = tar({
    'package/dist/build.json': Buffer.from(JSON.stringify({ fingerprint })),
    'package/dist/yoga.wasm': MODULE,
  });
  return async (url) => {
    if (url.endsWith('/latest'))
      return Response.json({
        name: '@soundor/yoga-wasm',
        version: '0.1.0',
        dist: {
          tarball:
            'https://registry.npmjs.org/@soundor/yoga-wasm/-/yoga-wasm-0.1.0.tgz',
          integrity:
            integrity ??
            `sha512-${createHash('sha512').update(archive).digest('base64')}`,
        },
      });
    return new Response(archive);
  };
}

test('reuses the published module when the inputs are the same', async () => {
  assert.deepEqual(await publishedModule(FINGERPRINT, registry()), MODULE);
});

test('compiles when the published module has other inputs', async () => {
  const fetcher = registry({ fingerprint: 'a'.repeat(64) });
  assert.equal(await publishedModule(FINGERPRINT, fetcher), null);
});

test('compiles when nothing is published yet', async () => {
  const fetcher = async () => new Response('', { status: 404 });
  assert.equal(await publishedModule(FINGERPRINT, fetcher), null);
});

test('fails, rather than compiling, when npm cannot answer', async () => {
  const fetcher = async () => new Response('', { status: 503 });
  await assert.rejects(publishedModule(FINGERPRINT, fetcher), /HTTP 503/);
});

test('fails on an archive that is not what npm promised', async () => {
  const integrity = `sha512-${Buffer.alloc(64).toString('base64')}`;
  await assert.rejects(
    publishedModule(FINGERPRINT, registry({ integrity })),
    /integrity/,
  );
});

test('reads only the regular files it was asked for', () => {
  const files = readTarball(
    tar({ 'package/a': Buffer.from('a'), 'package/b': Buffer.from('b') }),
    ['package/b'],
  );
  assert.deepEqual([...files.keys()], ['package/b']);
  assert.equal(files.get('package/b').toString(), 'b');
});

test("reads the engine's Yoga pin", () => {
  assert.deepEqual(
    yogaPin(
      'set(SOUNDOR_YOGA_VERSION "1.2.3")\nset(SOUNDOR_YOGA_REVISION "abc")\nset(SOUNDOR_YOGA_SHA256 "def")\n',
    ),
    { version: '1.2.3', revision: 'abc', sha256: 'def' },
  );
  assert.match(yogaPin().revision, /^[0-9a-f]{40}$/);
  assert.throws(() => yogaPin('nothing'), /SOUNDOR_YOGA_VERSION/);
});

test('knows the ways to find a module, and refuses any other', () => {
  assert.equal(moduleMode({}), 'default');
  assert.equal(moduleMode({ SOUNDOR_YOGA_WASM: '' }), 'default');
  assert.equal(moduleMode({ SOUNDOR_YOGA_WASM: 'source' }), 'source');
  assert.equal(moduleMode({ SOUNDOR_YOGA_WASM: 'release' }), 'release');
  // A typo in a workflow must not silently fall back to the cache.
  assert.throws(() => moduleMode({ SOUNDOR_YOGA_WASM: 'relase' }), /Unknown/);
});

test('a release stops when the published module has other bytes', () => {
  const compiled = Buffer.from('the module');
  assert.equal(publishedProblem(compiled, null), null);
  assert.equal(publishedProblem(compiled, Buffer.from('the module')), null);
  assert.match(
    publishedProblem(compiled, Buffer.from('another')),
    /other bytes/,
  );
});

test('finds the cache as the engine does', () => {
  assert.equal(soundorCache({ SOUNDOR_CACHE: '/x' }), '/x');
});
