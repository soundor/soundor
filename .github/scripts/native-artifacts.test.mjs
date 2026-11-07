import assert from 'node:assert/strict';
import test from 'node:test';

import {
  artifactKey,
  binaryArtifacts,
  findMainArtifacts,
  planNativeBuild,
} from './native-artifacts.mjs';

const now = Date.parse('2026-11-07T12:00:00Z');
const commit = 'a'.repeat(40);
const fingerprint = 'b'.repeat(64);
const repository = 'soundor/soundor';
const expires = new Date(now + 86400000).toISOString();
const key = artifactKey('engine', fingerprint, () => 'recipe');
const marker = {
  name: key,
  expired: false,
  expires_at: expires,
  created_at: new Date(now - 1000).toISOString(),
  workflow_run: { id: 123, head_sha: commit },
};
const run = {
  status: 'completed',
  conclusion: 'success',
  event: 'push',
  head_branch: 'main',
  path: '.github/workflows/verify.yml',
  head_repository: { full_name: repository },
  head_sha: commit,
};
const artifacts = (kind) =>
  binaryArtifacts(kind, commit).map((name) => ({
    name,
    expired: false,
    expires_at: expires,
  }));
const response = (value, status = 200) =>
  new Response(JSON.stringify(value), { status });
function lookup({
  kind = 'engine',
  markers = [marker],
  selectedRun = run,
  binaries = artifacts(kind),
  fetcher,
} = {}) {
  return findMainArtifacts({
    kind,
    key,
    repository,
    token: 'fixture-token',
    now,
    fetcher:
      fetcher ??
      (async (url, options) => {
        assert.equal(options.headers.Authorization, 'Bearer fixture-token');
        const path = new URL(url).pathname;
        if (path.endsWith('/actions/artifacts'))
          return response({ artifacts: markers });
        if (path.endsWith('/runs/123')) return response(selectedRun);
        if (path.endsWith('/runs/123/artifacts'))
          return response({ artifacts: binaries });
        throw new Error(`Unexpected request ${url}`);
      }),
  });
}

test('keys include native inputs, kind and build recipes, normalizing line endings', () => {
  assert.equal(
    key,
    artifactKey('engine', fingerprint, () => 'recipe'),
  );
  assert.notEqual(
    key,
    artifactKey('engine', 'c'.repeat(64), () => 'recipe'),
  );
  assert.notEqual(
    key,
    artifactKey('host', fingerprint, () => 'recipe'),
  );
  assert.notEqual(
    key,
    artifactKey('engine', fingerprint, () => 'changed toolchain'),
  );
  assert.equal(
    artifactKey('engine', fingerprint, () => 'a\r\nb'),
    artifactKey('engine', fingerprint, () => 'a\nb'),
  );
  assert.throws(() => artifactKey('unknown', fingerprint), /Invalid/);
  assert.throws(() => artifactKey('engine', 'bad'), /Invalid/);
});

test('finds complete engine and host builds, including both Windows engine families', async () => {
  assert.equal(binaryArtifacts('engine', commit).length, 4);
  for (const kind of ['engine', 'host'])
    assert.deepEqual(await lookup({ kind }), { run: '123', commit });
});

test('a miss, expired marker or a build older than seven days cannot be reused', async () => {
  for (const markers of [
    [],
    [{ ...marker, name: 'other-fingerprint' }],
    [{ ...marker, expired: true }],
    [{ ...marker, expires_at: new Date(now).toISOString() }],
    [{ ...marker, created_at: new Date(now - 8 * 86400000).toISOString() }],
  ])
    assert.equal(await lookup({ markers }), null);
});

test('rejects failed, incomplete, PR, fork and other-workflow runs', async () => {
  for (const patch of [
    { status: 'in_progress' },
    { conclusion: 'failure' },
    { conclusion: 'cancelled' },
    { event: 'pull_request' },
    { event: 'workflow_dispatch' },
    { head_branch: 'feature' },
    { path: '.github/workflows/other.yml' },
    { path: '.github/workflows/release.yml' },
    { head_repository: { full_name: 'fork/soundor' } },
    { head_sha: 'c'.repeat(40) },
    { head_sha: 'malformed' },
  ])
    assert.equal(await lookup({ selectedRun: { ...run, ...patch } }), null);
});

test('every platform artifact must still exist and be unexpired', async () => {
  for (const kind of ['engine', 'host']) {
    assert.equal(
      await lookup({ kind, binaries: artifacts(kind).slice(1) }),
      null,
    );
    assert.equal(
      await lookup({
        kind,
        binaries: artifacts(kind).map((a, index) =>
          index ? a : { ...a, expired: true },
        ),
      }),
      null,
    );
    assert.equal(
      await lookup({
        kind,
        binaries: artifacts(kind).map((a, index) =>
          index ? a : { ...a, expires_at: new Date(now).toISOString() },
        ),
      }),
      null,
    );
  }
});

test('continues past unusable markers and paginates artifacts', async () => {
  const seen = [];
  const result = await lookup({
    fetcher: async (url) => {
      const parsed = new URL(url);
      seen.push(url);
      if (parsed.pathname.endsWith('/actions/artifacts')) {
        assert.equal(parsed.searchParams.get('name'), key);
        return response({
          artifacts:
            parsed.searchParams.get('page') === '1'
              ? Array.from({ length: 100 }, () => ({
                  ...marker,
                  expired: true,
                }))
              : [marker],
        });
      }
      if (parsed.pathname.endsWith('/runs/123')) return response(run);
      return response({
        artifacts:
          parsed.searchParams.get('page') === '1'
            ? Array.from({ length: 100 }, () => ({
                name: 'unrelated',
                expires_at: expires,
              }))
            : artifacts('engine'),
      });
    },
  });
  assert.deepEqual(result, { run: '123', commit });
  assert.equal(seen.length, 5);
});

test('deleted candidates are misses, permission and service failures are errors', async () => {
  assert.equal(await lookup({ fetcher: async () => response({}, 404) }), null);
  assert.equal(await lookup({ selectedRun: null }), null);
  for (const status of [403, 429, 500])
    await assert.rejects(
      lookup({ fetcher: async () => response({}, status) }),
      new RegExp(`HTTP ${status}`),
    );
  await assert.rejects(
    lookup({
      fetcher: async () => {
        throw new Error('network down');
      },
    }),
    /network down/,
  );
});

test('planning preserves affected checks and same-commit main builds, and prefers published binaries', async () => {
  const mustNotLookup = () => {
    throw new Error('unexpected artifact lookup');
  };
  for (const selection of [{ mode: 'source' }, { mode: 'prebuilt' }]) {
    for (const event of ['push', 'workflow_dispatch'])
      assert.deepEqual(
        await planNativeBuild({
          affected: false,
          event,
          selection,
          find: mustNotLookup,
        }),
        { build: selection.mode === 'source', reused: null },
      );
    assert.deepEqual(
      await planNativeBuild({
        affected: true,
        event: 'pull_request',
        selection: { mode: 'source' },
        find: mustNotLookup,
      }),
      { build: true, reused: null },
    );
  }
  assert.deepEqual(
    await planNativeBuild({
      affected: false,
      event: 'pull_request',
      selection: { mode: 'prebuilt' },
      find: mustNotLookup,
    }),
    { build: false, reused: null },
  );
  for (const kind of ['engine', 'host']) {
    const reused = { run: '123', commit };
    const options = {
      affected: false,
      event: 'pull_request',
      selection: { mode: 'source' },
    };
    assert.deepEqual(
      await planNativeBuild({ ...options, find: () => lookup({ kind }) }),
      { build: false, reused },
    );
    assert.deepEqual(
      await planNativeBuild({
        ...options,
        find: () => lookup({ kind, markers: [] }),
      }),
      { build: true, reused: null },
    );
  }
});
