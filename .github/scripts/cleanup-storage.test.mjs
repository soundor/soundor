import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { planCleanup, relatedPulls, cleanup } from './cleanup-storage.mjs';
import { binaryArtifacts } from './native-artifacts.mjs';

const repository = 'soundor/soundor';
const now = Date.parse('2026-11-10T12:00:00Z');
const date = (days) => new Date(now - days * 86_400_000).toISOString();
const hash = (n) => String(n).repeat(64);
const sha = (n) => String(n).repeat(40);
const pull = (number, state = 'closed') => ({
  number,
  state,
  head: { ref: `branch-${number}`, repo: { full_name: repository } },
  base: { repo: { full_name: repository } },
});
const run = (id, overrides = {}) => ({
  id,
  path: '.github/workflows/verify.yml',
  event: 'push',
  head_branch: 'main',
  head_sha: sha(id),
  head_repository: { full_name: repository },
  status: 'completed',
  conclusion: 'success',
  ...overrides,
});
const artifact = (id, runId, name, age = 3) => ({
  id,
  workflow_run: { id: runId },
  name,
  created_at: date(age),
  expired: false,
  size_in_bytes: 100,
});
const cache = (id, key, age = 3, ref = 'refs/heads/main', version = 'v1') => ({
  id,
  key,
  created_at: date(age),
  ref,
  version,
});
const plan = (overrides = {}) =>
  planCleanup({
    artifacts: [],
    caches: [],
    runs: [],
    pulls: [],
    active: [],
    repository,
    now,
    ...overrides,
  });
const ids = (result) => result.map((item) => item.id);
const nativeSet = (id, age = 3, key = `native-engine-${hash(1)}`) => [
  artifact(id * 10, id, key, age),
  ...binaryArtifacts('engine', sha(id)).map((name, i) =>
    artifact(id * 10 + i + 1, id, name, age),
  ),
];

test('closed PR scope removes only completed PR artifacts and exact merge-ref caches', () => {
  const runs = [
    run(1, {
      event: 'pull_request',
      head_branch: 'branch-1',
      pull_requests: [{ number: 1 }],
    }),
    run(2),
  ];
  const result = plan({
    pr: 1,
    runs,
    pulls: [pull(1), pull(2, 'open')],
    artifacts: [artifact(1, 1, 'anything'), artifact(2, 2, 'main')],
    caches: [
      cache(3, 'key', 3, 'refs/pull/1/merge'),
      cache(4, 'key', 3, 'refs/pull/2/merge'),
      cache(5, 'key'),
    ],
  });
  assert.deepEqual(ids(result).sort(), [1, 3]);
});
test('PR-close cleanup does not block itself, but still protects active consumers', () => {
  const prRun = run(1, {
    event: 'pull_request',
    head_branch: 'branch-1',
    pull_requests: [{ number: 1 }],
  });
  const cleanupRun = run(2, {
    event: 'pull_request_target',
    path: '.github/workflows/cleanup.yml',
    head_branch: 'branch-1',
    status: 'in_progress',
  });
  const input = {
    pr: 1,
    runs: [prRun],
    pulls: [pull(1)],
    artifacts: [artifact(1, 1, 'test')],
    caches: [cache(2, 'key', 3, 'refs/pull/1/merge')],
    active: [cleanupRun],
  };
  assert.deepEqual(ids(plan(input)).sort(), [1, 2]);
  assert.equal(
    plan({ ...input, active: [cleanupRun, { ...prRun, status: 'queued' }] })
      .length,
    0,
  );
});

test('open, unknown, running, and branch-reused PRs are preserved', () => {
  const prRun = run(1, { event: 'pull_request', head_branch: 'branch-1' });
  const input = {
    runs: [prRun],
    pulls: [pull(1)],
    artifacts: [artifact(1, 1, 'test')],
    caches: [cache(2, 'key', 3, 'refs/pull/1/merge')],
  };
  assert.equal(plan({ ...input, pulls: [pull(1, 'open')] }).length, 0);
  assert.equal(plan({ ...input, pulls: [] }).length, 0);
  assert.equal(
    plan({ ...input, active: [{ ...prRun, status: 'in_progress' }] }).length,
    0,
  );
  assert.equal(
    plan({ ...input, runs: [{ ...prRun, status: 'queued' }] }).filter(
      (a) => a.type === 'artifact',
    ).length,
    0,
  );
  const reused = { ...pull(2, 'open'), head: pull(1).head };
  assert.equal(
    plan({ ...input, pulls: [pull(1), reused] }).filter(
      (a) => a.type === 'artifact',
    ).length,
    0,
  );
  assert.equal(
    relatedPulls(
      { ...prRun, head_repository: { full_name: 'fork/soundor' } },
      [pull(1)],
      repository,
    ).length,
    0,
  );
});
test('complete native sets prune together, with two mature replacements per fingerprint', () => {
  const runs = [run(1), run(2), run(3), run(4)];
  const artifacts = [
    ...nativeSet(1, 5),
    ...nativeSet(2, 4),
    ...nativeSet(3, 2),
    ...nativeSet(4, 0.5),
  ];
  assert.deepEqual(ids(plan({ artifacts, runs })), ids(nativeSet(1, 5)));
  assert.equal(
    plan({
      artifacts,
      runs: runs.map((r) => (r.id === 3 ? { ...r, conclusion: 'failure' } : r)),
    }).length,
    0,
  );
  assert.equal(
    plan({ artifacts: artifacts.filter((a) => a.id !== 34), runs }).length,
    0,
  );
  assert.equal(
    plan({
      artifacts: artifacts.map((a) =>
        a.id === 30 ? { ...a, name: `native-engine-${hash(2)}` } : a,
      ),
      runs,
    }).length,
    0,
  );
});
test('main cleanup pauses for queued, waiting and running native consumers', () => {
  const artifacts = [1, 2, 3].flatMap((n) => nativeSet(n, 6 - n));
  for (const status of ['queued', 'waiting', 'in_progress'])
    assert.equal(
      plan({
        artifacts,
        runs: [run(1), run(2), run(3)],
        active: [run(9, { status })],
      }).length,
      0,
    );
});
test('signed snapshots group by exact identity; release intermediates preserve failed runs', () => {
  const runs = [1, 2, 3, 4].map((n) =>
    run(n, {
      path: '.github/workflows/release.yml',
      conclusion: n === 4 ? 'failure' : 'success',
    }),
  );
  const artifacts = [
    artifact(1, 1, `verified-native-windows-${hash(1)}`, 5),
    artifact(2, 2, `verified-native-windows-${hash(1)}`, 4),
    artifact(3, 3, `verified-native-windows-${hash(1)}`, 2),
    artifact(4, 4, 'packed-retry'),
    artifact(5, 3, 'packed-published'),
    artifact(6, 3, `verified-native-windows-static-${hash(2)}`),
    artifact(7, 3, 'dependency-candidate', 0.2),
  ];
  assert.deepEqual(ids(plan({ runs, artifacts })).sort(), [1, 5]);
});
test('cache snapshots preserve distinct configurations and backend versions', () => {
  const caches = [
    cache(1, `ccache-windows-build-${sha(1)}`, 5),
    cache(2, `ccache-windows-build-${sha(2)}`, 4),
    cache(3, `ccache-windows-build-${sha(3)}`, 2),
    cache(4, `ccache-windows-static-build-${sha(1)}`, 6),
    cache(5, `ccache-windows-build-${sha(1)}`, 6, 'refs/heads/main', 'v2'),
    cache(6, 'unknown-key', 10),
  ];
  assert.deepEqual(ids(plan({ caches })), [1]);
});
test('dependency caches retain all completion variants in two mature recipe generations', () => {
  const caches = [
    cache(1, `native-deps-windows-msvc14-${hash(1)}-aaaaaaaaaaaaaaaa`, 6),
    cache(2, `native-deps-windows-msvc14-${hash(1)}-bbbbbbbbbbbbbbbb`, 5),
    cache(3, `native-deps-windows-msvc14-${hash(2)}`, 4),
    cache(4, `native-deps-windows-msvc14-${hash(3)}`, 2),
    cache(5, `native-deps-windows-static-msvc14-${hash(1)}`, 6),
  ];
  assert.deepEqual(ids(plan({ caches })).sort(), [1, 2]);
});
test('pnpm requires a mature current lockfile cache on each platform', () => {
  const caches = [
    cache(1, `Linux-pnpm-store-${hash(1)}`, 6),
    cache(2, `Linux-pnpm-store-${hash(2)}`, 2),
    cache(3, `Windows-pnpm-store-${hash(1)}`, 5),
    cache(4, `Windows-pnpm-store-${hash(2)}`, 0.5),
  ];
  assert.deepEqual(ids(plan({ caches, lockHash: hash(2) })), [1]);
  assert.equal(plan({ caches }).length, 0);
});

test('workflow executes main only, with no install or PR interpolation into shell', () => {
  const yaml = readFileSync(
    new URL('../workflows/cleanup.yml', import.meta.url),
    'utf8',
  );
  assert.match(yaml, /pull_request_target:\n\s+types: \[closed\]/);
  assert.match(yaml, /ref: refs\/heads\/main/);
  assert.match(yaml, /persist-credentials: false/);
  assert.match(yaml, /default: false/);
  assert.doesNotMatch(
    yaml,
    /pnpm install|npm install|download-artifact|pull_request.head/,
  );
  assert.match(yaml, /run: node \.github\/scripts\/cleanup-storage.mjs/);
});

test('API pagination, dry run, and reopened-PR recheck prevent unwanted deletion', async () => {
  const calls = [];
  let pullReads = 0;
  const prRun = run(1, {
    event: 'pull_request',
    head_branch: 'branch-1',
    pull_requests: [{ number: 1 }],
  });
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname.replace('/repos/soundor/soundor', '');
    calls.push([path, options.method, new URL(url).search]);
    let data;
    if (path === '/actions/artifacts')
      data = { artifacts: [artifact(1, 1, 'test')] };
    else if (path === '/actions/caches') data = { actions_caches: [] };
    else if (path === '/pulls') {
      pullReads++;
      data =
        pullReads === 1
          ? Array.from({ length: 100 }, (_, i) => pull(i + 1))
          : new URL(url).searchParams.get('page') === '2'
            ? []
            : [pull(1, 'open')];
    } else if (path === '/actions/runs/1') data = prRun;
    else if (path === '/actions/runs') data = { workflow_runs: [] };
    else throw new Error(`Unexpected request: ${path}`);
    return { ok: true, status: 200, json: async () => data };
  };
  await cleanup({ repository, token: 'fixture', fetcher, apply: true });
  assert(
    calls.some(
      ([path, , query]) => path === '/pulls' && query.includes('page=2'),
    ),
  );
  assert(!calls.some(([, method]) => method === 'DELETE'));
  calls.length = 0;
  pullReads = 0;
  await cleanup({ repository, token: 'fixture', fetcher });
  assert(!calls.some(([, method]) => method === 'DELETE'));
});

test('replacement age includes the last archive, and expired archives cannot replace a set', () => {
  const runs = [run(1), run(2), run(3)];
  const artifacts = [1, 2, 3].flatMap((n) => nativeSet(n, 6 - n));
  assert.equal(
    plan({
      runs,
      artifacts: artifacts.map((a) =>
        a.id === 34 ? { ...a, created_at: date(0.1) } : a,
      ),
    }).length,
    0,
  );
  assert.equal(
    plan({
      runs,
      artifacts: artifacts.map((a) =>
        a.id === 34 ? { ...a, expired: true } : a,
      ),
    }).length,
    0,
  );
  assert.equal(
    plan({
      runs: runs.map((r) => ({
        ...r,
        head_repository: { full_name: 'other/repository' },
      })),
      artifacts,
    }).length,
    0,
  );
});

test('apply deletes only selected IDs and tolerates an already-deleted entry', async () => {
  const deletes = [];
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname.replace('/repos/soundor/soundor', '');
    if (options.method === 'DELETE') {
      deletes.push(path);
      return { ok: false, status: 404 };
    }
    let data;
    if (path === '/actions/artifacts')
      data = { artifacts: [artifact(42, 1, 'closed-pr-output')] };
    else if (path === '/actions/caches')
      data = {
        actions_caches: [cache(43, 'pr-cache', 3, 'refs/pull/1/merge')],
      };
    else if (path === '/pulls') data = [pull(1)];
    else if (path === '/actions/runs/1')
      data = run(1, { event: 'pull_request', pull_requests: [{ number: 1 }] });
    else if (path === '/actions/runs') data = { workflow_runs: [] };
    else throw new Error(`Unexpected request: ${path}`);
    return { ok: true, status: 200, json: async () => data };
  };
  await cleanup({ repository, token: 'fixture', fetcher, apply: true });
  assert.deepEqual(deletes.sort(), [
    '/actions/artifacts/42',
    '/actions/caches/43',
  ]);
});

test('API errors fail closed before any deletes', async () => {
  let deletes = 0;
  const fetcher = async (_url, options) => {
    if (options.method === 'DELETE') deletes++;
    return { ok: false, status: 403 };
  };
  await assert.rejects(
    cleanup({ repository, token: 'fixture', fetcher, apply: true }),
    /HTTP 403/,
  );
  assert.equal(deletes, 0);
});
