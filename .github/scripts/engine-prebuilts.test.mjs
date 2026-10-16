// node --test .github/scripts/engine-prebuilts.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import {
  abiNamespace,
  assemble,
  checkPack,
  decide,
  github,
  manifest,
  manifestText,
  pack,
  plan,
  plannedEngine,
  release,
  targets,
  variants,
} from './engine-prebuilts.mjs';

const work = mkdtempSync(join(tmpdir(), 'engine-prebuilts-'));
after(() => rmSync(work, { recursive: true, force: true }));
const commit = 'a3f91c2d'.padEnd(40, '0');
const later = 'b4e02d1f'.padEnd(40, '1');
const planned = plan({ version: '0.2.1', commit, revision: 1 });

/** A small staged engine, as soundor_engine_stage lays one out. */
function stage(target, variant, edit = (metadata) => metadata) {
  const directory = mkdtempSync(join(work, 'stage-'));
  const debug = variant === 'debug';
  const hermes = ['hermes/lib/libhermesVMRuntime.a', 'hermes/lib/libjsi.a'];
  if (debug) hermes.push('hermes/lib/libhermesParser.a');
  const metadata = edit({
    format: 1,
    engine: { version: '0.2.1', abiNamespace: 'v0_2_1', sourceCommit: commit },
    variant,
    configuration: debug ? 'Debug' : 'Release',
    target: {
      name: target,
      os: target.split('-')[0],
      architectures: target === 'macos-universal' ? ['arm64', 'x64'] : ['x64'],
      minimumOsVersion: target === 'macos-universal' ? '12.0' : '',
    },
    toolchain: {
      compiler: 'Clang',
      compilerVersion: '18.1.3',
      msvcRuntime:
        target === 'windows-x64'
          ? debug
            ? 'MultiThreadedDebugDLL'
            : 'MultiThreadedDLL'
          : '',
    },
    features: { devtools: debug, jsSource: debug, gpu: true, accessKit: false },
    hermes: {
      revision: 'abc',
      bytecodeVersion: '96',
      compiler: 'hermes/bin/hermesc',
    },
    link: {
      engine: ['lib/libsoundor_runtime.a'],
      hermes,
      skia: ['skia/lib/libskia.a'],
      angle: ['angle/lib/libangle.a'],
      accessKit: [],
      system: ['dl'],
      frameworks: [],
    },
  });
  const write = (path, contents) => {
    mkdirSync(join(directory, path, '..'), { recursive: true });
    writeFileSync(join(directory, path), contents);
  };
  write('soundor-engine.json', JSON.stringify(metadata));
  for (const file of [
    ...metadata.link.engine,
    ...hermes,
    'skia/lib/libskia.a',
    'angle/lib/libangle.a',
  ])
    write(file, `${target} ${variant} ${file}`);
  write('hermes/bin/hermesc', 'hermesc');
  for (const component of ['engine', 'hermes', 'ada', 'yoga', 'skia', 'angle'])
    write(`licenses/${component}/LICENSE`, `${component} license`);
  // Longer than a ustar name holds.
  write(`hermes/include/${'deeply/'.repeat(14)}nested.h`, '#pragma once\n');
  return directory;
}

describe('naming', () => {
  test('the ABI namespace follows the exact engine version', () => {
    assert.equal(abiNamespace('0.1.0'), 'v0_1_0');
    assert.equal(abiNamespace('0.2.1'), 'v0_2_1');
    assert.equal(abiNamespace('1.0.0-beta.1'), 'v1_0_0_p2d626574612e31');
    assert.throws(() => abiNamespace('1.0'));
  });

  test('a plan names the release, its archives and its revision', () => {
    assert.equal(planned.tag, 'engine-prebuilts-v0.2.1-a3f91c2d-r1');
    assert.equal(planned.archives.length, targets.length * variants.length);
    assert.ok(
      planned.assets.includes(
        'soundor-engine-0.2.1-macos-universal-release.tar.gz',
      ),
    );
    assert.ok(planned.assets.includes('build-info.json'));
    assert.throws(
      () => plan({ version: '0.2.1', commit: 'a3f91c2', revision: 1 }),
      /full source commit/,
    );
    assert.throws(
      () => plan({ version: '0.2.1', commit, revision: 0 }),
      /revision/,
    );
  });
});

describe('pack', () => {
  test('is deterministic and extracts to the stage', async () => {
    const source = stage('linux-x64', 'debug');
    const first = await pack(source, join(work, 'pack-1'), planned);
    const second = await pack(source, join(work, 'pack-2'), planned);
    assert.equal(first.sha256, second.sha256);
    assert.equal(first.file, 'soundor-engine-0.2.1-linux-x64-debug.tar.gz');
    const bytes = readFileSync(join(work, 'pack-1', first.file));
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      first.sha256,
    );
    const out = join(work, 'extracted');
    mkdirSync(out);
    execFileSync('tar', ['xzf', join(work, 'pack-1', first.file), '-C', out]);
    const top = join(out, 'soundor-engine-0.2.1-linux-x64-debug');
    assert.equal(
      readFileSync(
        join(top, `hermes/include/${'deeply/'.repeat(14)}nested.h`),
        'utf8',
      ),
      '#pragma once\n',
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(top, 'soundor-engine.json'))).engine
        .sourceCommit,
      commit,
    );
  });

  const rejects = {
    'another engine version': [
      (m) => ({ ...m, engine: { ...m.engine, version: '0.2.2' } }),
      /engine.version/,
    ],
    'another source commit': [
      (m) => ({ ...m, engine: { ...m.engine, sourceCommit: later } }),
      /sourceCommit/,
    ],
    'a release engine with DevTools': [
      (m) => ({
        ...m,
        variant: 'release',
        configuration: 'Release',
        features: { ...m.features, jsSource: false },
      }),
      /devtools/,
    ],
    'a missing library': [
      (m) => ({ ...m, link: { ...m.link, skia: ['skia/lib/gone.a'] } }),
      /gone.a is missing/,
    ],
  };
  for (const [name, [edit, message]] of Object.entries(rejects))
    test(`rejects ${name}`, async () => {
      await assert.rejects(
        pack(
          stage('linux-x64', 'debug', edit),
          join(work, 'rejected'),
          planned,
        ),
        message,
      );
    });

  test("rejects a release engine with Hermes's compiler", async () => {
    const source = stage('linux-x64', 'release', (m) => ({
      ...m,
      link: {
        ...m.link,
        hermes: [...m.link.hermes, 'hermes/lib/libhermesParser.a'],
      },
    }));
    writeFileSync(join(source, 'hermes/lib/libhermesParser.a'), 'parser');
    await assert.rejects(
      pack(source, join(work, 'rejected'), planned),
      /compiler/,
    );
  });

  test('rejects missing license notices and symbolic links', async () => {
    const unlicensed = stage('linux-x64', 'debug');
    rmSync(join(unlicensed, 'licenses/skia'), { recursive: true });
    await assert.rejects(
      pack(unlicensed, join(work, 'rejected'), planned),
      /license notice for skia/,
    );
    const linked = stage('linux-x64', 'debug');
    symlinkSync('LICENSE', join(linked, 'licenses/engine/COPY'));
    await assert.rejects(
      pack(linked, join(work, 'rejected'), planned),
      /symbolic link/,
    );
  });
});

async function packAll(directory, edit) {
  for (const target of targets)
    for (const variant of variants)
      await pack(stage(target, variant, edit), directory, {
        ...planned,
        target,
      });
}

describe('assemble', () => {
  test('writes build-info.json, SHA256SUMS and notes from the same data', async () => {
    const directory = join(work, 'all');
    await packAll(directory);
    const info = await assemble(directory, join(work, 'assets'), planned);
    assert.equal(info.artifacts.length, 6);
    assert.equal(info.sourceCommit, commit);
    assert.equal(info.abiNamespace, 'v0_2_1');
    const sums = readFileSync(join(work, 'assets', 'SHA256SUMS'), 'utf8');
    const notes = readFileSync(
      join(work, 'assets', 'release-notes.md'),
      'utf8',
    );
    for (const artifact of info.artifacts) {
      assert.ok(sums.includes(`${artifact.sha256}  ${artifact.file}`));
      assert.ok(notes.includes(artifact.sha256));
    }
    assert.ok(notes.includes(commit));
  });

  test('rejects an incomplete set', async () => {
    const directory = join(work, 'partial');
    await pack(stage('linux-x64', 'debug'), directory, planned);
    await assert.rejects(
      assemble(directory, join(work, 'out'), planned),
      /incomplete/,
    );
  });

  test('rejects an archive changed after packing', async () => {
    const directory = join(work, 'tampered');
    await packAll(directory);
    writeFileSync(
      join(directory, 'soundor-engine-0.2.1-windows-x64-release.tar.gz'),
      'tampered',
    );
    await assert.rejects(
      assemble(directory, join(work, 'out'), planned),
      /SHA-256/,
    );
  });
});

/** A GitHub Releases API in memory, with public downloads. */
async function fakeGitHub() {
  const releases = [];
  let next = 1;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = new URL(request.url, base);
    const reply = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(value === undefined ? '' : JSON.stringify(value));
    };
    const find = (id) => releases.find((r) => r.id === Number(id));
    let match;
    if (request.method === 'GET' && url.pathname === '/repos/o/r/releases')
      return reply(
        200,
        releases
          .slice((Number(url.searchParams.get('page')) - 1) * 100)
          .slice(0, 100),
      );
    if (request.method === 'POST' && url.pathname === '/repos/o/r/releases') {
      const value = JSON.parse(body);
      if (releases.some((r) => r.tag_name === value.tag_name))
        return reply(422, { message: 'tag exists' });
      const id = next++;
      const created = {
        ...value,
        id,
        assets: [],
        upload_url: `${base}/upload/${id}/assets{?name,label}`,
        html_url: `${base}/r/${id}`,
      };
      releases.push(created);
      return reply(201, created);
    }
    if ((match = /^\/upload\/(\d+)\/assets$/.exec(url.pathname))) {
      const target = find(match[1]);
      if (!target.draft) return reply(422, { message: 'immutable' });
      const id = next++;
      const name = url.searchParams.get('name');
      target.assets.push({
        id,
        name,
        contents: body,
        digest: `sha256:${createHash('sha256').update(body).digest('hex')}`,
        browser_download_url: `${base}/download/${id}`,
      });
      return reply(201, { id });
    }
    if (
      (match = /^\/download\/(\d+)$/.exec(url.pathname)) ||
      (match = /^\/repos\/o\/r\/releases\/assets\/(\d+)$/.exec(url.pathname))
    ) {
      const asset = releases
        .flatMap((r) => r.assets)
        .find((a) => a.id === Number(match[1]));
      if (request.method === 'DELETE') {
        const owner = releases.find((r) => r.assets.includes(asset));
        if (!owner.draft) return reply(422, { message: 'immutable' });
        owner.assets = owner.assets.filter((a) => a !== asset);
        return reply(204);
      }
      response.writeHead(200);
      return response.end(asset.contents);
    }
    if ((match = /^\/repos\/o\/r\/releases\/tags\/(.+)$/.exec(url.pathname))) {
      const found = releases.find(
        (r) => r.tag_name === decodeURIComponent(match[1]) && !r.draft,
      );
      return found
        ? reply(200, view(found))
        : reply(404, { message: 'Not Found' });
    }
    if ((match = /^\/repos\/o\/r\/releases\/(\d+)$/.exec(url.pathname))) {
      const found = find(match[1]);
      if (request.method === 'DELETE') {
        releases.splice(releases.indexOf(found), 1);
        return reply(204);
      }
      if (request.method === 'PATCH') {
        Object.assign(found, JSON.parse(body));
        return reply(200, view(found));
      }
      return reply(200, view(found));
    }
    reply(404, { message: `${request.method} ${url.pathname}` });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const view = (r) => ({
    ...r,
    assets: r.assets.map(({ contents: _contents, ...asset }) => asset),
  });
  return {
    releases,
    client: github({ repository: 'o/r', token: 't', api: base }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

describe('the release', async () => {
  const directory = join(work, 'release-archives');
  await packAll(directory);
  const assets = join(work, 'release-assets');
  await assemble(directory, assets, planned);
  for (const file of planned.archives.map((a) => a.file))
    writeFileSync(join(assets, file), readFileSync(join(directory, file)));

  test('stage mode verifies a draft and leaves nothing behind', async () => {
    const gh = await fakeGitHub();
    try {
      assert.equal(
        (await decide(gh.client, { version: '0.2.1', commit })).action,
        'build',
      );
      assert.deepEqual(
        await release(gh.client, assets, planned, { mode: 'stage' }),
        { staged: true },
      );
      assert.equal(gh.releases.length, 0);
    } finally {
      await gh.close();
    }
  });

  test('publishes once, then reuses the verified release', async () => {
    const gh = await fakeGitHub();
    try {
      const result = await release(gh.client, assets, planned, {
        mode: 'publish',
      });
      assert.equal(result.published, true);
      const [published] = gh.releases;
      assert.equal(published.draft, false);
      assert.equal(published.make_latest, 'false');
      assert.equal(published.target_commitish, commit);
      const again = await decide(gh.client, { version: '0.2.1', commit });
      assert.equal(again.action, 'reuse');
      assert.equal(again.plan.tag, planned.tag);
      // A later commit with the same unpublished version needs its own.
      const newer = await decide(gh.client, {
        version: '0.2.1',
        commit: later,
      });
      assert.equal(newer.action, 'build');
      assert.equal(newer.plan.tag, 'engine-prebuilts-v0.2.1-b4e02d1f-r1');
      // A defective release is never replaced: a higher revision is built.
      const revised = await decide(gh.client, {
        version: '0.2.1',
        commit,
        revision: 2,
      });
      assert.equal(revised.action, 'build');
      assert.equal(revised.plan.tag, 'engine-prebuilts-v0.2.1-a3f91c2d-r2');
      await assert.rejects(
        release(gh.client, assets, planned, {
          mode: 'publish',
          draft: published.id,
        }),
        /already published/,
      );
    } finally {
      await gh.close();
    }
  });

  test('a run after an interrupted one finishes its draft', async () => {
    const gh = await fakeGitHub();
    try {
      const draft = await gh.client.call('POST', '/releases', {
        body: { tag_name: planned.tag, draft: true, target_commitish: commit },
      });
      await gh.client.call(
        'POST',
        draft.upload_url.replace(/\{.*\}$/, '') + '?name=build-info.json',
        {
          body: Buffer.from('{"partial":true}'),
        },
      );
      const decision = await decide(gh.client, { version: '0.2.1', commit });
      assert.deepEqual([decision.action, decision.draft], ['build', draft.id]);
      await release(gh.client, assets, planned, {
        mode: 'publish',
        draft: decision.draft,
      });
      assert.equal(gh.releases.length, 1);
      assert.equal(gh.releases[0].assets.length, planned.assets.length);
    } finally {
      await gh.close();
    }
  });

  test('rejects a published release whose archives or metadata disagree', async () => {
    const gh = await fakeGitHub();
    try {
      await release(gh.client, assets, planned, { mode: 'publish' });
      const archive = gh.releases[0].assets.find((a) =>
        a.name.endsWith('linux-x64-release.tar.gz'),
      );
      archive.contents = Buffer.from('corrupted');
      archive.digest = `sha256:${createHash('sha256').update(archive.contents).digest('hex')}`;
      await assert.rejects(
        decide(gh.client, { version: '0.2.1', commit }),
        /build-info.json says/,
      );
      const info = gh.releases[0].assets.find(
        (a) => a.name === 'build-info.json',
      );
      info.contents = Buffer.from(
        JSON.stringify({ ...JSON.parse(info.contents), sourceCommit: later }),
      );
      await assert.rejects(
        decide(gh.client, { version: '0.2.1', commit }),
        /sourceCommit/,
      );
    } finally {
      await gh.close();
    }
  });
});

describe('the npm release', async () => {
  test('finds @soundor/engine in a Changesets publish plan', () => {
    const entry = (name, version) => ({
      kind: 'publish',
      name,
      version,
      access: 'public',
      tag: 'latest',
    });
    assert.equal(
      plannedEngine({
        version: 1,
        plan: [
          [entry('@soundor/core', '0.4.0'), entry('@soundor/engine', '0.2.1')],
        ],
      }),
      '0.2.1',
    );
    assert.equal(
      plannedEngine({ version: 1, plan: [[entry('@soundor/core', '0.4.0')]] }),
      null,
    );
    assert.equal(
      plannedEngine({
        version: 1,
        plan: [[{ kind: 'tag', name: '@soundor/engine', version: '0.2.1' }]],
      }),
      null,
    );
    assert.throws(() => plannedEngine({ plan: [] }), /format/);
  });

  const directory = join(work, 'npm-archives');
  await packAll(directory);
  const assets = join(work, 'npm-assets');
  await assemble(directory, assets, planned);
  for (const file of planned.archives.map((a) => a.file))
    writeFileSync(join(assets, file), readFileSync(join(directory, file)));

  test('writes the manifest from the verified public release only', async () => {
    const gh = await fakeGitHub();
    try {
      const draft = await gh.client.call('POST', '/releases', {
        body: { tag_name: planned.tag, draft: true },
      });
      await assert.rejects(
        manifest(gh.client, draft, planned),
        /not published/,
      );
      await gh.client.call('DELETE', `/releases/${draft.id}`);
      await release(gh.client, assets, planned, { mode: 'publish' });
      const published = await gh.client.call(
        'GET',
        `/releases/tags/${planned.tag}`,
      );
      const value = await manifest(gh.client, published, planned);
      assert.equal(value.sourceCommit, commit);
      assert.equal(value.tag, planned.tag);
      assert.equal(value.artifacts.length, 6);
      for (const artifact of value.artifacts) {
        const response = await fetch(artifact.url);
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.equal(
          createHash('sha256').update(bytes).digest('hex'),
          artifact.sha256,
        );
      }
      // A release whose archive changed after publishing yields no manifest.
      gh.releases[0].assets[0].contents = Buffer.from('changed');
      await assert.rejects(manifest(gh.client, published, planned));
    } finally {
      await gh.close();
    }
  });

  function packed(name, files) {
    const root = mkdtempSync(join(work, 'npm-'));
    for (const [path, contents] of Object.entries(files)) {
      mkdirSync(join(root, 'package', path, '..'), { recursive: true });
      writeFileSync(join(root, 'package', path), contents);
    }
    const out = mkdtempSync(join(work, 'pack-dir-'));
    execFileSync('tar', ['-czf', join(out, name), '-C', root, 'package']);
    return out;
  }
  const expected = { engineVersion: '0.2.1', tag: planned.tag, artifacts: [] };

  test('accepts the packed engine that carries exactly the manifest', () => {
    const out = packed('soundor-engine-0.2.1.tgz', {
      'package.json': '{"name":"@soundor/engine","version":"0.2.1"}',
      'artifacts/manifest.json': manifestText(expected),
      'cmake/SoundorEngineResolve.cmake': '',
    });
    assert.equal(checkPack(out, expected), 'soundor-engine-0.2.1.tgz');
  });

  const wrong = {
    'no manifest': [{}, /no artifacts\/manifest.json/],
    'another manifest': [
      {
        'artifacts/manifest.json': manifestText({ ...expected, tag: 'other' }),
      },
      /another/,
    ],
    'build output': [
      {
        'artifacts/manifest.json': manifestText(expected),
        'build/dev/libsoundor_runtime.a': '',
      },
      /build output/,
    ],
  };
  for (const [name, [files, message]] of Object.entries(wrong))
    test(`rejects a packed engine with ${name}`, () => {
      const out = packed('soundor-engine-0.2.1.tgz', {
        'package.json': '{"name":"@soundor/engine","version":"0.2.1"}',
        ...files,
      });
      assert.throws(() => checkPack(out, expected), message);
    });
});
