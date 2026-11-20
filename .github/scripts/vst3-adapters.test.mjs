// Tests for vst3-adapters.mjs: packing, assembling and releasing the VST3
// runtime's prebuilt adapters, and the manifest its npm package carries.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { manifestText } from './engine-prebuilts.mjs';
import { fakeGitHub } from './fake-github.mjs';
import {
  adapterLibrary,
  assemble,
  checkPack,
  decide,
  localManifest,
  manifest,
  pack,
  plan,
  release,
  targets,
  variants,
} from './vst3-adapters.mjs';

const work = mkdtempSync(join(tmpdir(), 'vst3-adapters-'));
after(() => rmSync(work, { recursive: true, force: true }));
const commit = 'a3f91c2d'.padEnd(40, '0');
const version = '0.1.0';
const planned = plan({ version, commit, revision: 1 });
const engine = { version: '0.9.0', sourceFingerprint: 'f'.repeat(64) };

/** prebuilt/, as `build:native` stages it on every target. */
function prebuilt(edit = (metadata) => metadata, only = targets) {
  const directory = mkdtempSync(join(work, 'prebuilt-'));
  for (const target of only)
    for (const variant of variants) {
      const stage = join(directory, `${target}-${variant}`);
      mkdirSync(join(stage, 'lib'), { recursive: true });
      mkdirSync(join(stage, 'licenses', 'vst3sdk'), { recursive: true });
      writeFileSync(
        join(stage, 'lib', adapterLibrary(target)),
        `${target} ${variant}`,
      );
      writeFileSync(join(stage, 'licenses', 'vst3sdk', 'LICENSE.txt'), 'SDK');
      writeFileSync(
        join(stage, 'adapter.json'),
        JSON.stringify(
          edit(
            {
              format: 1,
              runtimeVersion: version,
              target,
              variant,
              vst3sdk: '3.8.1',
              engine,
            },
            target,
            variant,
          ),
        ),
      );
    }
  return directory;
}

async function packed(edit) {
  const out = mkdtempSync(join(work, 'archives-'));
  await pack(prebuilt(edit), out, { version, commit });
  return out;
}

describe('naming', () => {
  test('a plan names the release, its six archives and its revision', () => {
    assert.equal(planned.tag, 'vst3-adapters-v0.1.0-a3f91c2d-r1');
    assert.equal(planned.archives.length, 6);
    assert.ok(
      planned.assets.includes(
        'soundor-vst3-adapter-0.1.0-windows-x64-debug.tar.gz',
      ),
    );
    assert.throws(() => plan({ version, commit: 'abc', revision: 1 }));
    assert.throws(() => plan({ version, commit, revision: 0 }));
  });
});

describe('pack', () => {
  test('is deterministic, with sidecars naming the commit', async () => {
    const stages = prebuilt();
    const first = mkdtempSync(join(work, 'first-'));
    const second = mkdtempSync(join(work, 'second-'));
    const a = await pack(stages, first, { version, commit });
    const b = await pack(stages, second, { version, commit });
    assert.deepEqual(
      a.map((s) => s.sha256),
      b.map((s) => s.sha256),
    );
    const sidecar = JSON.parse(
      readFileSync(
        join(first, 'soundor-vst3-adapter-0.1.0-linux-x64-release.tar.gz.json'),
        'utf8',
      ),
    );
    assert.equal(sidecar.sourceCommit, commit);
    assert.deepEqual(sidecar.engine, engine);
    const listing = execFileSync('tar', [
      '-tzf',
      join(first, 'soundor-vst3-adapter-0.1.0-linux-x64-release.tar.gz'),
    ]).toString();
    assert.match(
      listing,
      /^soundor-vst3-adapter-0\.1\.0-linux-x64-release\/lib\/libsoundor_vst3\.a$/m,
    );
  });

  test('rejects a stage of another version, or without its library', async () => {
    await assert.rejects(
      pack(
        prebuilt((m) => ({ ...m, runtimeVersion: '0.0.9' })),
        work,
        {
          version,
          commit,
        },
      ),
      /it is runtime 0\.0\.9, not 0\.1\.0/,
    );
    const stages = prebuilt(undefined, ['linux-x64']);
    rmSync(join(stages, 'linux-x64-debug', 'lib', 'libsoundor_vst3.a'));
    await assert.rejects(
      pack(stages, work, { version, commit }),
      /lib\/libsoundor_vst3\.a is missing/,
    );
  });
});

describe('assemble', () => {
  test('writes build-info.json and SHA256SUMS from the same data', async () => {
    const archives = await packed();
    const out = mkdtempSync(join(work, 'assets-'));
    const info = await assemble(archives, out, planned);
    assert.equal(info.artifacts.length, 6);
    assert.deepEqual(info.engine, engine);
    const sums = readFileSync(join(out, 'SHA256SUMS'), 'utf8');
    for (const artifact of info.artifacts)
      assert.ok(sums.includes(`${artifact.sha256}  ${artifact.file}`));
  });

  test('rejects adapters built against different engines', async () => {
    const archives = await packed((m, target) =>
      target === 'windows-x64'
        ? { ...m, engine: { ...engine, sourceFingerprint: 'e'.repeat(64) } }
        : m,
    );
    await assert.rejects(
      assemble(archives, mkdtempSync(join(work, 'assets-')), planned),
      /built against different engines/,
    );
  });

  test('rejects an incomplete set', async () => {
    const archives = await packed();
    rmSync(join(archives, planned.archives[0].file));
    await assert.rejects(
      assemble(archives, mkdtempSync(join(work, 'assets-')), planned),
      /incomplete or mixed/,
    );
  });
});

describe('the release', async () => {
  const archives = await packed();
  const assets = mkdtempSync(join(work, 'release-assets-'));
  await assemble(archives, assets, planned);
  for (const { file } of planned.archives)
    writeFileSync(join(assets, file), readFileSync(join(archives, file)));

  test('publishes once, then reuses the verified release', async () => {
    const gh = await fakeGitHub();
    try {
      assert.equal(
        (await decide(gh.client, { version, commit })).action,
        'build',
      );
      const result = await release(gh.client, assets, planned, {
        mode: 'publish',
      });
      assert.equal(result.published, true);
      assert.match(gh.releases[0].name, /^VST3 adapters 0\.1\.0/);
      const again = await decide(gh.client, { version, commit });
      assert.equal(again.action, 'reuse');
      assert.equal(again.plan.tag, planned.tag);

      const value = await manifest(
        gh.client,
        await gh.client.call('GET', `/releases/tags/${planned.tag}`),
        planned,
      );
      assert.equal(value.runtimeVersion, version);
      assert.deepEqual(value.engine, engine);
      assert.equal(value.artifacts.length, 6);
      assert.ok(value.artifacts.every((a) => a.url.includes('/download/')));
    } finally {
      await gh.close();
    }
  });

  test('a local manifest names the archives on disk', () => {
    const value = localManifest(archives, { version, commit });
    assert.equal(value.tag, 'local');
    assert.ok(value.artifacts.every((a) => a.url.startsWith('file:')));
    assert.throws(
      () => localManifest(archives, { version, commit: 'b'.repeat(40) }),
      /another commit/,
    );
  });
});

describe('the npm package', () => {
  const expected = {
    format: 1,
    runtimeVersion: version,
    sourceCommit: commit,
    revision: 1,
    tag: planned.tag,
    release: 'https://example/r',
    engine,
    artifacts: [],
  };

  function tarball(files) {
    const directory = mkdtempSync(join(work, 'pack-'));
    const root = join(directory, 'package');
    for (const [path, contents] of Object.entries(files)) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), contents);
    }
    execFileSync('tar', [
      '-czf',
      join(directory, `soundor-vst3-runtime-${version}.tgz`),
      '-C',
      directory,
      'package',
    ]);
    rmSync(root, { recursive: true });
    return directory;
  }

  test('carries exactly the manifest, and no adapter', () => {
    const files = {
      'package.json': JSON.stringify({ version }),
      'artifacts/manifest.json': manifestText(expected),
    };
    assert.match(checkPack(tarball(files), expected), /\.tgz$/);
    assert.throws(
      () =>
        checkPack(
          tarball({
            ...files,
            'prebuilt/linux-x64-release/lib/libsoundor_vst3.a': 'x',
          }),
          expected,
        ),
      /contains build output/,
    );
    assert.throws(
      () =>
        checkPack(
          tarball({
            ...files,
            'artifacts/manifest.json': manifestText({
              ...expected,
              revision: 2,
            }),
          }),
          expected,
        ),
      /another artifacts\/manifest\.json/,
    );
  });
});
