// Metadata-only cleanup. Never download or execute an artifact or PR code.
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { binaryArtifacts } from './native-artifacts.mjs';

const DAY = 86_400_000;
const MAIN = 'refs/heads/main';
const SHA = '[a-f0-9]{40}';
const HASH = '[a-f0-9]{64}';
const producers = new Set([
  '.github/workflows/verify.yml',
  '.github/workflows/release.yml',
  '.github/workflows/engine-prebuilts.yml',
]);
const newest = (items) =>
  [...items].sort(
    (a, b) =>
      Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id,
  );
const groupBy = (items, key) => {
  const groups = new Map();
  for (const item of items) {
    const name = key(item);
    if (name === null) continue;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(item);
  }
  return groups;
};

export function relatedPulls(run, pulls, repository) {
  const explicit = new Set((run.pull_requests ?? []).map((pr) => pr.number));
  // Some Actions API responses omit pull_requests. Match both branch and source
  // repository, including open PRs if someone reused a branch after closing one.
  return pulls.filter(
    (pr) =>
      explicit.has(pr.number) ||
      (pr.head?.ref === run.head_branch &&
        pr.head?.repo?.full_name === run.head_repository?.full_name &&
        pr.base?.repo?.full_name === repository),
  );
}

export function planCleanup({
  artifacts,
  caches,
  runs,
  pulls,
  active = [],
  repository,
  now = Date.now(),
  pr = null,
  lockHash = '',
}) {
  const plan = [];
  const old = (item) => Date.parse(item.created_at) <= now - DAY;
  const runMap = new Map(runs.map((run) => [run.id, run]));
  const closed = (related) =>
    related.length > 0 &&
    related.every((p) => p.state === 'closed') &&
    (pr === null || related.some((p) => p.number === pr));
  const busyPR = (number) =>
    active.some(
      (run) =>
        // The PR-close cleanup is itself an active run associated with this PR.
        // It consumes no build outputs and must not block its own deletion plan.
        run.path !== '.github/workflows/cleanup.yml' &&
        relatedPulls(run, pulls, repository).some((p) => p.number === number),
    );
  const eligiblePR = (related) =>
    closed(related) && related.every((p) => !busyPR(p.number));
  const add = (type, item, reason) =>
    plan.push({
      type,
      id: item.id,
      name: item.name ?? item.key,
      bytes: item.size_in_bytes ?? 0,
      reason,
      run: item.workflow_run?.id,
      ref: item.ref,
    });
  for (const cache of caches) {
    const match = /^refs\/pull\/(\d+)\/merge$/.exec(cache.ref);
    if (match && eligiblePR(pulls.filter((p) => p.number === Number(match[1]))))
      add('cache', cache, 'closed PR');
  }
  for (const artifact of artifacts) {
    const run = runMap.get(artifact.workflow_run?.id);
    if (
      run?.event === 'pull_request' &&
      run.status === 'completed' &&
      eligiblePR(relatedPulls(run, pulls, repository))
    )
      add('artifact', artifact, 'closed PR');
  }
  if (pr !== null || active.some((run) => producers.has(run.path))) return plan;

  const mainRun = (run) =>
    run?.head_branch === 'main' &&
    run.head_repository?.full_name === repository &&
    ['push', 'workflow_dispatch'].includes(run.event) &&
    run.status === 'completed' &&
    run.conclusion === 'success' &&
    producers.has(run.path);
  const mainArtifacts = artifacts.filter(
    (a) => !a.expired && mainRun(runMap.get(a.workflow_run?.id)),
  );
  // Require TWO mature replacements; a new upload never displaces a working set.
  const prune = (items, reason, remove) => {
    const sorted = newest(items);
    const mature = sorted.filter(old);
    if (mature.length < 3) return;
    const boundary = Date.parse(mature[1].created_at);
    for (const item of sorted)
      if (old(item) && Date.parse(item.created_at) < boundary)
        remove(item, reason);
  };
  const sets = [];
  for (const marker of mainArtifacts) {
    const match = new RegExp(`^native-(engine|host)-${HASH}$`).exec(
      marker.name,
    );
    const run = runMap.get(marker.workflow_run.id);
    if (!match || run.path !== '.github/workflows/verify.yml') continue;
    const expected = binaryArtifacts(match[1], run.head_sha);
    const members = mainArtifacts.filter(
      (a) => a.workflow_run.id === run.id && expected.includes(a.name),
    );
    if (expected.every((name) => members.some((a) => a.name === name)))
      sets.push({
        ...marker,
        created_at: newest([marker, ...members])[0].created_at,
        members: [marker, ...members],
      });
  }
  for (const items of groupBy(sets, (a) => a.name).values())
    prune(items, 'superseded complete native set', (set, reason) => {
      // Remove lookup first: partial API failures leave an unselectable set.
      for (const member of set.members) add('artifact', member, reason);
    });
  for (const items of groupBy(mainArtifacts, (a) =>
    new RegExp(`^verified-native-.+-${HASH}$`).test(a.name) ? a.name : null,
  ).values()) {
    prune(items, 'superseded signed snapshot', (a, reason) =>
      add('artifact', a, reason),
    );
  }
  for (const artifact of mainArtifacts) {
    const run = runMap.get(artifact.workflow_run.id);
    // Keep signed snapshots. Release intermediates are no longer inputs after
    // the ENTIRE root workflow succeeds; failed runs retain their retry inputs.
    if (
      old(artifact) &&
      [
        '.github/workflows/release.yml',
        '.github/workflows/engine-prebuilts.yml',
      ].includes(run.path) &&
      !artifact.name.startsWith('verified-native-')
    )
      add('artifact', artifact, 'successful release intermediate');
  }

  const mainCaches = caches.filter((c) => c.ref === MAIN);
  const snapshotFamily = (c) => {
    for (const regex of [
      new RegExp(`^(ccache-.+)-${SHA}$`),
      new RegExp(`^(engine-consumer-.+)-${SHA}$`),
      new RegExp(`^(clang-tidy)-${SHA}$`),
    ]) {
      const match = regex.exec(c.key);
      if (match) return `${match[1]}:${c.version}`;
    }
    return null;
  };
  for (const items of groupBy(mainCaches, snapshotFamily).values())
    prune(items, 'superseded cache snapshot', (c, reason) =>
      add('cache', c, reason),
    );
  const dependencyKey = (cache) =>
    new RegExp(`^(native-deps-.+)-(${HASH})(?:-[a-f0-9]{16})?$`).exec(
      cache.key,
    );
  for (const items of groupBy(mainCaches, (c) => {
    const match = dependencyKey(c);
    return match ? `${match[1]}:${c.version}` : null;
  }).values()) {
    const generations = [
      ...groupBy(items, (c) => dependencyKey(c)[2]).values(),
    ].map((members) => ({ ...newest(members)[0], members }));
    prune(
      generations,
      'superseded dependency generation',
      (generation, reason) => {
        for (const member of generation.members) add('cache', member, reason);
      },
    );
  }
  if (new RegExp(`^${HASH}$`).test(lockHash)) {
    for (const items of groupBy(
      mainCaches,
      (c) =>
        /^(Linux|macOS|Windows)-pnpm-store-[a-f0-9]{64}$/.exec(c.key)?.[1] ??
        null,
    ).values()) {
      const current = items.filter((c) => c.key.endsWith(`-${lockHash}`));
      if (current.some(old))
        for (const item of items)
          if (old(item) && !item.key.endsWith(`-${lockHash}`))
            add('cache', item, 'superseded pnpm lockfile');
    }
  }
  // Unknown keys/artifacts, incomplete sets and failed main runs expire normally.
  return [
    ...new Map(plan.map((item) => [`${item.type}:${item.id}`, item])).values(),
  ];
}

export async function cleanup({
  repository,
  token,
  pr = null,
  apply = false,
  lockHash = '',
  fetcher = fetch,
}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !token)
    throw new Error('Repository and token required');
  const request = async (path, method = 'GET') => {
    const response = await fetcher(
      `https://api.github.com/repos/${repository}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (response.status === 404 && method === 'DELETE') return null;
    if (!response.ok)
      throw new Error(`Cleanup API ${method} ${path}: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
  const list = async (path, field) => {
    const result = [];
    for (let page = 1; ; page++) {
      const data = await request(
        `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
      );
      const items = field ? data[field] : data;
      if (!Array.isArray(items)) throw new Error('Unexpected API listing');
      result.push(...items);
      if (items.length < 100) return result;
    }
  };
  const activeRuns = async () => {
    const results = await Promise.all(
      ['queued', 'in_progress', 'waiting', 'pending', 'requested'].map(
        (status) => list(`/actions/runs?status=${status}`, 'workflow_runs'),
      ),
    );
    return results.flat();
  };
  const [artifacts, caches, pulls, active] = await Promise.all([
    list('/actions/artifacts', 'artifacts'),
    list('/actions/caches', 'actions_caches'),
    list('/pulls?state=all', null),
    activeRuns(),
  ]);
  const readRuns = async (ids) => {
    const result = [];
    for (let start = 0; start < ids.length; start += 10) {
      result.push(
        ...(await Promise.all(
          ids
            .slice(start, start + 10)
            .map((id) => request(`/actions/runs/${id}`)),
        )),
      );
    }
    return result;
  };
  const runs = await readRuns([
    ...new Set(
      artifacts.map((a) => a.workflow_run?.id).filter(Number.isSafeInteger),
    ),
  ]);
  const inventory = {
    artifacts,
    caches,
    pulls,
    active,
    runs,
    repository,
    pr,
    lockHash,
  };
  const plan = planCleanup(inventory);
  const bytes = plan.reduce((sum, item) => sum + item.bytes, 0);
  console.log(
    JSON.stringify(
      { mode: apply ? 'apply' : 'dry-run', count: plan.length, bytes, plan },
      null,
      2,
    ),
  );
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Storage cleanup (${apply ? 'apply' : 'dry run'})\n\nSelected ${plan.length} entries (${(bytes / 1024 ** 3).toFixed(2)} GiB).\n\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\`\n`,
    );
  if (apply) {
    // Refresh mutable PR/run state immediately before deletion. New artifacts and
    // caches are never introduced into the original plan by this second pass.
    const freshPulls = await list('/pulls?state=all', null);
    const freshActive = await activeRuns();
    const freshRuns = await readRuns(runs.map((run) => run.id));
    const allowed = new Set(
      planCleanup({
        ...inventory,
        pulls: freshPulls,
        active: freshActive,
        runs: freshRuns,
      }).map((item) => `${item.type}:${item.id}`),
    );
    for (const item of plan) {
      if (!allowed.has(`${item.type}:${item.id}`)) continue;
      await request(
        `/actions/${item.type === 'cache' ? 'caches' : 'artifacts'}/${item.id}`,
        'DELETE',
      );
    }
  }
  return plan;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const value = process.env.CLEANUP_PR;
  if (value && !/^[1-9]\d*$/.test(value)) throw new Error('Invalid PR number');
  await cleanup({
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN,
    pr: value ? Number(value) : null,
    apply: process.env.CLEANUP_APPLY === 'true',
    lockHash: process.env.CLEANUP_LOCK_HASH,
  });
}
