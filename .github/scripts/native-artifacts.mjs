// Reuse complete native builds from successful pushes to this repository's main.
// A small fingerprint-named marker, uploaded by the planner, indexes the run;
// the run must finish successfully and retain every expected binary artifact.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const recipes = {
  engine: [
    '.github/workflows/engine.yml',
    '.github/scripts/engine-prebuilts.mjs',
    '.github/actions/native-deps/action.yml',
    '.github/actions/native-deps-save/action.yml',
  ],
  host: [
    '.github/workflows/vst3-host-artifacts.yml',
    'hosts/vst3-host/scripts/release.ts',
    'hosts/vst3-host/src/provenance.ts',
    'hosts/vst3-host/targets.json',
  ],
};

export function artifactKey(kind, fingerprint, read = readFileSync) {
  if (!recipes[kind] || !/^[a-f0-9]{64}$/.test(fingerprint))
    throw new Error('Invalid native artifact identity');
  const hash = createHash('sha256').update(
    `native-artifacts-v1\0${kind}\0${fingerprint}\0`,
  );
  for (const file of [
    ...recipes[kind],
    '.github/actions/setup/action.yml',
    '.nvmrc',
  ]) {
    hash.update(file).update('\0');
    hash.update(read(file, 'utf8').replaceAll('\r\n', '\n')).update('\0');
  }
  return `native-${kind}-${hash.digest('hex')}`;
}

export function binaryArtifacts(kind, commit) {
  if (kind === 'engine')
    return [
      'linux-x64',
      'macos-universal',
      'windows-x64',
      'windows-x64-static',
    ].map((target) => `engine-prebuilt-${commit}-${target}`);
  if (kind === 'host')
    return ['linux-x64-gnu', 'darwin-universal', 'win32-x64'].map(
      (target) => `vst3-host-${commit}-${target}`,
    );
  throw new Error('Unknown native artifact kind');
}

export async function findMainArtifacts({
  kind,
  key,
  repository = process.env.GITHUB_REPOSITORY,
  token = process.env.GITHUB_TOKEN,
  fetcher = fetch,
  now = Date.now(),
}) {
  if (!repository || !token)
    throw new Error('Artifact lookup requires a repository and token');
  const api = `https://api.github.com/repos/${repository}`;
  const request = async (path) => {
    const response = await fetcher(api + path, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404) return null; // Deleted between listing and reading.
    if (!response.ok)
      throw new Error(`Native artifact lookup: HTTP ${response.status}`);
    return response.json();
  };
  const available = (artifact) =>
    !artifact.expired && Date.parse(artifact.expires_at) > now;
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  for (let page = 1; ; page++) {
    const markers = await request(
      `/actions/artifacts?name=${encodeURIComponent(key)}&per_page=100&page=${page}`,
    );
    if (!markers) return null;
    for (const marker of markers.artifacts) {
      if (
        marker.name !== key ||
        !available(marker) ||
        Date.parse(marker.created_at) < cutoff
      )
        continue;
      const id = marker.workflow_run?.id;
      if (!Number.isSafeInteger(id)) continue;
      const run = await request(`/actions/runs/${id}`);
      if (
        !run ||
        run.status !== 'completed' ||
        run.conclusion !== 'success' ||
        run.event !== 'push' ||
        run.head_branch !== 'main' ||
        run.path !== '.github/workflows/release.yml' ||
        run.head_repository?.full_name !== repository ||
        !/^[a-f0-9]{40}$/.test(run.head_sha) ||
        marker.workflow_run.head_sha !== run.head_sha
      )
        continue;
      const found = new Set();
      for (let artifactsPage = 1; ; artifactsPage++) {
        const artifacts = await request(
          `/actions/runs/${id}/artifacts?per_page=100&page=${artifactsPage}`,
        );
        if (!artifacts) break;
        for (const artifact of artifacts.artifacts)
          if (available(artifact)) found.add(artifact.name);
        if (artifacts.artifacts.length < 100) break;
      }
      if (binaryArtifacts(kind, run.head_sha).every((name) => found.has(name)))
        return { run: String(id), commit: run.head_sha };
    }
    if (markers.artifacts.length < 100) return null;
  }
}

export async function planNativeBuild({ affected, event, selection, find }) {
  // Affected packages retain their full checks. Main builds from its own commit
  // for releases; only unchanged PR consumers may reuse earlier main binaries.
  const reused =
    !affected && selection.mode === 'source' && event === 'pull_request'
      ? await find()
      : null;
  return { build: selection.mode === 'source' && reused === null, reused };
}
