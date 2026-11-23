import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assetName,
  completeInstalls,
  dependencyGroup,
  download,
  fetchInstall,
  nextTag,
  parseAsset,
  recipeHash,
  releasedIndex,
  verificationArgs,
} from './native-deps-release.mjs';

const tool = fileURLToPath(
  new URL('./native-deps-archive.py', import.meta.url),
);
const commit = 'a'.repeat(40);
const skia = 'skia-ed427fd003-linux-x64-14bb906dacac';
const hermes = 'hermes-602befee34-mac-arm64-x86_64-lto-0fe54dadc94e/md';
const temporary = () => mkdtempSync(join(tmpdir(), 'native-deps-'));
const sha256 = (data) =>
  `sha256:${createHash('sha256').update(data).digest('hex')}`;

const asset = (name, extra = {}) => ({
  name,
  browser_download_url: `https://github.com/o/r/releases/download/x/${name}`,
  digest: `sha256:${'b'.repeat(64)}`,
  size: 1,
  ...extra,
});
const release = (tag, names, extra = {}) => ({
  tag_name: tag,
  target_commitish: commit,
  draft: false,
  assets: [asset('attestation.jsonl'), ...names.map((name) => asset(name))],
  ...extra,
});

test('the recipes label covers only what builds Skia, ANGLE and Hermes', () => {
  const root = temporary();
  const cmake = join(root, 'engine/cmake');
  for (const directory of ['skia', 'angle', 'hermes', 'yoga'])
    mkdirSync(join(cmake, directory), { recursive: true });
  const write = (path, text) => writeFileSync(join(cmake, path), text);
  write('SoundorSkiaBuild.cmake', 'skia');
  write('SoundorDependencies.cmake', 'pins');
  write('hermes/CMakeLists.txt', 'hermes');
  write('SoundorYoga.cmake', 'yoga');
  write('yoga/patch', 'yoga');
  const before = recipeHash(root);
  assert.match(before, /^[a-f0-9]{12}$/);
  write('SoundorYoga.cmake', 'yoga 2');
  write('yoga/patch', 'yoga 2');
  assert.equal(recipeHash(root), before);
  write('hermes/CMakeLists.txt', 'hermes\r\n');
  assert.equal(recipeHash(root), recipeHash(root));
  write('hermes/CMakeLists.txt', 'hermes 2');
  assert.notEqual(recipeHash(root), before);
});

test('a group names the job and the toolchain install names leave out', () => {
  const version = (compiler) => ({ clang: '18', gcc: '13' })[compiler];
  assert.equal(
    dependencyGroup({
      job: 'linux-clang',
      platform: 'linux',
      env: { CC: 'clang', ImageOS: 'ubuntu24' },
      version,
    }),
    'linux-clang-ubuntu24-clang18',
  );
  assert.equal(
    dependencyGroup({
      job: 'linux-gcc',
      platform: 'linux',
      env: { CC: '/usr/bin/gcc', ImageOS: 'ubuntu24' },
      version,
    }),
    'linux-gcc-ubuntu24-gcc13-clang18',
  );
  assert.equal(
    dependencyGroup({
      job: 'macos-universal',
      platform: 'darwin',
      env: { SOUNDOR_XCODE: '16.4' },
      version,
    }),
    'macos-universal-xcode16.4',
  );
  assert.equal(
    dependencyGroup({
      job: 'windows-static',
      platform: 'win32',
      env: { SOUNDOR_MSVC_TOOLSET: 'v143-14.44' },
      version,
    }),
    'windows-static-msvcv143-14.44',
  );
  assert.throws(
    () =>
      dependencyGroup({ job: 'macos', platform: 'darwin', env: {}, version }),
    /SOUNDOR_XCODE/,
  );
  assert.throws(
    () =>
      dependencyGroup({
        job: 'bad--job',
        platform: 'win32',
        env: { SOUNDOR_MSVC_TOOLSET: 'v143' },
        version,
      }),
    /Invalid/,
  );
});

test('asset names round-trip and reject anything that is not an install', () => {
  for (const install of [
    skia,
    hermes,
    'angle-7e08726e32-win-x64-0cbcd53782c0',
  ]) {
    const name = assetName('windows-msvcv143-14.44', install);
    assert.deepEqual(parseAsset(name), {
      group: 'windows-msvcv143-14.44',
      install,
    });
  }
  assert.equal(
    assetName('verify-ubuntu24-clang18', hermes),
    'verify-ubuntu24-clang18--hermes-602befee34-mac-arm64-x86_64-lto-0fe54dadc94e--md.tar.gz',
  );
  for (const name of [
    'attestation.jsonl',
    'g--skia-x.zip',
    'g--yoga-1.tar.gz',
    'g--hermes-x.tar.gz',
    'g--hermes-x--debug.tar.gz',
    'g--skia-x.partial.tar.gz',
    'g--../skia-x.tar.gz',
    'G--skia-x.tar.gz',
  ])
    assert.equal(parseAsset(name), null, name);
  assert.throws(() => assetName('g', 'skia-x/../../etc'), /Invalid/);
  assert.throws(() => assetName('g', 'hermes-x'), /Invalid/);
});

test('complete installs are those CMake finished, each Hermes flavor on its own', () => {
  const cache = temporary();
  const make = (path, marker) => {
    mkdirSync(join(cache, path), { recursive: true });
    if (marker) writeFileSync(join(cache, path, marker), 'done');
  };
  make(skia, 'defines.txt');
  make('skia-unfinished', null);
  make('angle-x64-1', 'libs.txt');
  make('angle-x64-2.partial', 'libs.txt');
  make('hermes-a-linux-x86_64-1/release', 'hermes.txt');
  make('hermes-a-linux-x86_64-1/md', null);
  make('yoga-1', 'defines.txt');
  writeFileSync(join(cache, 'skia-file'), '');
  assert.deepEqual(completeInstalls(cache), [
    'angle-x64-1',
    'hermes-a-linux-x86_64-1/release',
    skia,
  ]);
  assert.deepEqual(completeInstalls(join(cache, 'missing')), []);
});

test('only published native-deps releases with an attestation are indexed', () => {
  const a = assetName('g', skia);
  const b = assetName('g', hermes);
  const index = releasedIndex([
    release('native-deps-0123456789ab-r2', [a, b]),
    release('native-deps-0123456789ab-r1', [a]),
    release('native-deps-0123456789ab-r3', [assetName('h', skia)], {
      draft: true,
    }),
    release('@soundor/engine@1.0.0', [assetName('i', skia)]),
    release('native-deps-0123456789ab-r4', [assetName('j', skia)], {
      target_commitish: 'main',
    }),
    {
      ...release('native-deps-0123456789ab-r5', []),
      assets: [asset(assetName('k', skia))],
    },
  ]);
  assert.deepEqual(Object.keys(index).sort(), [a, b].sort());
  assert.equal(index[a].tag, 'native-deps-0123456789ab-r2');
  assert.equal(index[a].commit, commit);
  assert.match(index[a].bundle.url, /attestation\.jsonl$/);
});

test('each publish takes the next revision of its recipes, drafts included', () => {
  const releases = [
    release('native-deps-0123456789ab-r1', []),
    release('native-deps-0123456789ab-r3', [], { draft: true }),
    release('native-deps-ffffffffffff-r7', []),
    release('vst3-adapters-v0.1.0-433d2aea-r9', []),
  ];
  assert.equal(
    nextTag(releases, '0123456789ab'),
    'native-deps-0123456789ab-r4',
  );
  assert.equal(
    nextTag(releases, 'aaaaaaaaaaaa'),
    'native-deps-aaaaaaaaaaaa-r1',
  );
});

test('fetched archives must come from Verify on main at the release commit', () => {
  assert.deepEqual(verificationArgs('f', 'b', 'o/r', commit), [
    'attestation',
    'verify',
    'f',
    '--bundle',
    'b',
    '--repo',
    'o/r',
    '--signer-workflow',
    'o/r/.github/workflows/verify.yml',
    '--source-ref',
    'refs/heads/main',
    '--source-digest',
    commit,
    '--deny-self-hosted-runners',
  ]);
});

test('downloads refuse bytes that are not the published ones', async () => {
  const file = join(temporary(), 'f');
  const fetcher = async () => new Response('payload');
  await download('https://x/f', file, sha256('payload'), { fetcher });
  assert.equal(readFileSync(file, 'utf8'), 'payload');
  await assert.rejects(
    download('https://x/f', file, sha256('other'), { fetcher }),
    /does not match/,
  );
  await assert.rejects(
    download('https://x/f', file, null, {
      fetcher: async () => new Response('', { status: 404 }),
    }),
    /HTTP 404/,
  );
});

test('a fetch verifies the attestation before unpacking, and misses build', async () => {
  const scratch = temporary();
  const name = assetName('g', skia);
  const index = {
    [name]: {
      tag: 'native-deps-0123456789ab-r1',
      commit,
      url: 'https://x/archive',
      digest: sha256('archive'),
      bundle: { url: 'https://x/bundle', digest: sha256('bundle') },
    },
  };
  const calls = [];
  const fetched = await fetchInstall({
    cache: '/cache',
    install: skia,
    group: 'g',
    index,
    repository: 'o/r',
    scratch,
    fetcher: async (url) =>
      new Response(url.endsWith('archive') ? 'archive' : 'bundle'),
    execute: (program, args) => calls.push([program, args[0], args[1]]),
    log: () => {},
  });
  assert.equal(fetched, true);
  assert.deepEqual(
    calls.map(([program, first]) => [
      program === 'gh' ? 'gh' : 'python',
      first,
    ]),
    [
      ['gh', 'attestation'],
      ['python', tool],
    ],
  );
  assert.equal(existsSync(join(scratch, name)), false);
  assert.equal(
    await fetchInstall({
      cache: '/cache',
      install: hermes,
      group: 'g',
      index,
      repository: 'o/r',
      scratch,
      fetcher: () => assert.fail('no download for a miss'),
      execute: () => assert.fail('nothing to verify'),
      log: () => {},
    }),
    false,
  );
  await assert.rejects(
    fetchInstall({
      cache: '/cache',
      install: skia,
      group: 'g',
      index,
      repository: 'o/r',
      scratch: temporary(),
      fetcher: async () => new Response('tampered'),
      execute: () => assert.fail('nothing verified or unpacked'),
      log: () => {},
    }),
    /does not match/,
  );
});

const python = process.platform === 'win32' ? 'python' : 'python3';
const archive = (...args) =>
  execFileSync(python, ['-I', tool, ...args], { stdio: 'pipe' });

test('an install packs and unpacks whole, under its own name only', () => {
  const root = temporary();
  const cache = join(root, 'cache');
  const install = 'hermes-a-linux-x86_64-1/release';
  mkdirSync(join(cache, install, 'bin'), { recursive: true });
  writeFileSync(join(cache, install, 'hermes.txt'), 'revision a\n');
  writeFileSync(join(cache, install, 'bin/hermesc'), 'binary');
  const file = join(root, 'install.tar.gz');
  archive('pack', cache, install, file);
  const target = join(root, 'target');
  archive('unpack', file, target, install);
  assert.equal(
    readFileSync(join(target, install, 'bin/hermesc'), 'utf8'),
    'binary',
  );
  assert.equal(existsSync(join(target, `${install}.fetching`)), false);
  // Over what a build left unfinished, never over an install, never as
  // another one, never an incomplete one.
  const unfinished = join(root, 'unfinished');
  mkdirSync(join(unfinished, install, 'bin'), { recursive: true });
  writeFileSync(join(unfinished, install, 'bin/stale'), 'stale');
  archive('unpack', file, unfinished, install);
  assert.equal(existsSync(join(unfinished, install, 'bin/stale')), false);
  assert.equal(existsSync(join(unfinished, install, 'hermes.txt')), true);
  assert.throws(
    () => archive('unpack', file, target, install),
    /already exists/,
  );
  assert.throws(
    () =>
      archive(
        'unpack',
        file,
        join(root, 'other'),
        'hermes-a-linux-x86_64-1/md',
      ),
    /Unsafe archive member/,
  );
  mkdirSync(join(cache, 'skia-unfinished'));
  assert.throws(
    () => archive('pack', cache, 'skia-unfinished', join(root, 'x.tar.gz')),
    /Incomplete install/,
  );
  assert.throws(
    () => archive('pack', cache, '../skia-x', join(root, 'x.tar.gz')),
    /Not a native dependency install/,
  );
});

test('archives with links or paths outside the install are refused', () => {
  const root = temporary();
  const file = join(root, 'evil.tar.gz');
  execFileSync(python, [
    '-I',
    '-c',
    `import io, tarfile, sys
with tarfile.open(sys.argv[1], 'w:gz') as t:
    for name in ['skia-x', 'skia-x/defines.txt']:
        info = tarfile.TarInfo(name)
        if name == 'skia-x':
            info.type = tarfile.DIRTYPE
            t.addfile(info)
        else:
            info.size = 1
            t.addfile(info, io.BytesIO(b'x'))
    link = tarfile.TarInfo('skia-x/link')
    link.type = tarfile.SYMTYPE
    link.linkname = '/etc/passwd'
    t.addfile(link)`,
    file,
  ]);
  assert.throws(
    () => archive('unpack', file, join(root, 'cache'), 'skia-x'),
    /Unsafe archive member: skia-x\/link/,
  );
  assert.equal(existsSync(join(root, 'cache', 'skia-x')), false);
});
