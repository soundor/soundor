// Skia, ANGLE and Hermes that main's CI built, kept as GitHub releases so that
// no job builds them again until their recipes change. The Actions cache is
// the fast path and evicts; these releases are immutable and never expire.
//
// The unit is an install: a directory of the Soundor cache that the engine's
// CMake names after what made it (skia-<...>, angle-<...>, and each flavor of
// hermes-<...>/<flavor>), so a name never means two builds. An asset is one
// install of one dependency group (the job's cache name and its toolchain:
// directory names do not tell compilers apart), `<group>--<install>.tar.gz`.
//
//   index    (each job using native dependencies) lists the released installs,
//            and has CMake run `fetch` before it builds one (SOUNDOR_DEPENDENCY_FETCH,
//            engine/cmake/SoundorDependencies.cmake)
//   fetch    downloads one, checks its digest and attestation, and unpacks it
//   offer    (a successful job on main) packs the complete installs no release has
//   prepare  (Verify's publish job) keeps what is still unreleased, names the release
//   publish  creates it: native-deps-<recipes>-r<n>, a prerelease, never latest
//
// A release only adds installs that earlier ones lack: nothing is uploaded twice,
// and a later run completes what an earlier one did not build. Revoking a bad
// install: delete its release; the next main run publishes it again, rebuilt.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const archiveTool = fileURLToPath(
  new URL('./native-deps-archive.py', import.meta.url),
);
const python = process.platform === 'win32' ? 'python' : 'python3';
const signerWorkflow = '.github/workflows/verify.yml';
const bundleName = 'attestation.jsonl';
const TAG = /^native-deps-([a-f0-9]{12})-r([1-9][0-9]*)$/;
const GROUP = /^[a-z0-9][a-z0-9.]*(?:-[a-z0-9.]+)*$/;
const INSTALL =
  /^(?:(?:skia|angle)-[a-z0-9_]+(?:-[a-z0-9_]+)*|hermes-[a-z0-9_]+(?:-[a-z0-9_]+)*\/(?:release|md|mdd|mt|mtd))$/;
const markers = {
  skia: 'defines.txt',
  angle: 'libs.txt',
  hermes: 'hermes.txt',
};

/** The recipes the engine builds Skia, ANGLE and Hermes from, as the release's label. */
export function recipeHash(root = '.', read = readFileSync) {
  const directory = join(root, 'engine/cmake');
  const files = [];
  const visit = (relative) => {
    for (const entry of readdirSync(join(directory, relative), {
      withFileTypes: true,
    })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (relative || ['angle', 'hermes', 'skia'].includes(entry.name))
          visit(path);
      } else if (
        relative ||
        /^Soundor(?:Dependencies|Skia|Angle|Hermes|WindowsCrt)/.test(entry.name)
      )
        files.push(path);
    }
  };
  visit('');
  const hash = createHash('sha256').update('native-deps-v1\0');
  for (const file of files.sort())
    hash
      .update(file)
      .update('\0')
      .update(read(join(directory, file), 'utf8').replaceAll('\r\n', '\n'))
      .update('\0');
  return hash.digest('hex').slice(0, 12);
}

/** The job's cache name and its toolchain, which install names leave out. */
export function dependencyGroup({ job, platform, env, version }) {
  let group = job;
  if (platform === 'darwin') {
    if (!env.SOUNDOR_XCODE) throw new Error('SOUNDOR_XCODE is not set');
    group += `-xcode${env.SOUNDOR_XCODE}`;
  } else if (platform === 'win32') {
    if (!env.SOUNDOR_MSVC_TOOLSET)
      throw new Error('SOUNDOR_MSVC_TOOLSET is not set');
    group += `-msvc${env.SOUNDOR_MSVC_TOOLSET}`;
  } else {
    // Skia and ANGLE build with clang where the project's compiler is not.
    const cc = basename(env.CC || 'cc');
    group += `-${(env.ImageOS ?? '').toLowerCase() || 'linux'}-${cc}${version(cc)}`;
    if (cc !== 'clang') group += `-clang${version('clang')}`;
  }
  group = group.toLowerCase();
  if (!GROUP.test(group)) throw new Error(`Invalid dependency group ${group}`);
  return group;
}

export function assetName(group, install) {
  if (!GROUP.test(group) || !INSTALL.test(install))
    throw new Error(`Invalid native dependency ${group} ${install}`);
  return `${group}--${install.replace('/', '--')}.tar.gz`;
}

/** The group and install an asset name holds, or null. */
export function parseAsset(name) {
  const match = /^(.+?)--(.+)\.tar\.gz$/.exec(name);
  if (!match) return null;
  const install = match[2].replace(
    /--(release|md|mdd|mt|mtd)$/,
    (_, flavor) => `/${flavor}`,
  );
  if (!GROUP.test(match[1]) || !INSTALL.test(install)) return null;
  return { group: match[1], install };
}

/** The complete installs of a Soundor cache (CMake writes their marker last). */
export function completeInstalls(cache) {
  if (!existsSync(cache)) return [];
  const installs = [];
  for (const entry of readdirSync(cache, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    if (!entry.isDirectory()) continue;
    const kind = /^(skia|angle|hermes)-/.exec(entry.name)?.[1];
    if (!kind) continue;
    const candidates =
      kind === 'hermes'
        ? readdirSync(join(cache, entry.name), { withFileTypes: true })
            .filter((flavor) => flavor.isDirectory())
            .map((flavor) => `${entry.name}/${flavor.name}`)
        : [entry.name];
    for (const install of candidates)
      if (
        INSTALL.test(install) &&
        existsSync(join(cache, install, markers[kind]))
      )
        installs.push(install);
  }
  return installs;
}

/**
 * The released installs: every asset of a published native-deps release, with
 * where to download it and the attestation bundle that covers it.
 */
export function releasedIndex(releases) {
  const assets = {};
  for (const release of releases) {
    if (release.draft || !TAG.test(release.tag_name ?? '')) continue;
    const commit = release.target_commitish;
    const bundle = release.assets?.find((asset) => asset.name === bundleName);
    if (!bundle || !/^[a-f0-9]{40}$/.test(commit ?? '')) continue;
    for (const asset of release.assets) {
      if (!parseAsset(asset.name) || assets[asset.name]) continue;
      assets[asset.name] = {
        tag: release.tag_name,
        commit,
        url: asset.browser_download_url,
        digest: asset.digest ?? null,
        size: asset.size,
        bundle: {
          url: bundle.browser_download_url,
          digest: bundle.digest ?? null,
        },
      };
    }
  }
  return assets;
}

/** The next release for these recipes; drafts count, a failed publish's included. */
export function nextTag(releases, hash) {
  let revision = 0;
  for (const release of releases) {
    const match = TAG.exec(release.tag_name ?? '');
    if (match?.[1] === hash) revision = Math.max(revision, Number(match[2]));
  }
  return `native-deps-${hash}-r${revision + 1}`;
}

export function verificationArgs(file, bundle, repository, commit) {
  return [
    'attestation',
    'verify',
    file,
    '--bundle',
    bundle,
    '--repo',
    repository,
    '--signer-workflow',
    `${repository}/${signerWorkflow}`,
    '--source-ref',
    'refs/heads/main',
    '--source-digest',
    commit,
    '--deny-self-hosted-runners',
  ];
}

export function github({
  repository = process.env.GITHUB_REPOSITORY,
  token = process.env.GITHUB_TOKEN,
  fetcher = fetch,
} = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !token)
    throw new Error('Native dependency releases need a repository and token');
  const call = async (method, path, { body, type } = {}) => {
    const url = path.startsWith('https://')
      ? path
      : `https://api.github.com/repos/${repository}${path}`;
    const response = await fetcher(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(type ? { 'Content-Type': type } : {}),
      },
      body: type || body === undefined ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (response.status === 404 && method === 'GET') return null;
    if (!response.ok)
      throw new Error(
        `Native dependency releases: ${method} ${url}: HTTP ${response.status} ${await response.text()}`,
      );
    return response.status === 204 ? null : response.json();
  };
  return {
    repository,
    call,
    async releases() {
      const all = [];
      for (let page = 1; ; page++) {
        const batch = await call('GET', `/releases?per_page=100&page=${page}`);
        all.push(...(batch ?? []));
        if (!batch || batch.length < 100) return all;
      }
    },
  };
}

/** Downloads a public asset, refusing anything but the published bytes. */
export async function download(url, file, digest, { fetcher = fetch } = {}) {
  const response = await fetcher(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(20 * 60_000),
  });
  if (!response.ok)
    throw new Error(`Downloading ${url} failed: HTTP ${response.status}`);
  const hash = createHash('sha256');
  let size = 0;
  await pipeline(
    Readable.fromWeb(response.body),
    new Transform({
      transform(chunk, _encoding, done) {
        size += chunk.length;
        if (size > 2 * 1024 ** 3)
          return done(new Error(`${url} exceeds the size limit`));
        hash.update(chunk);
        done(null, chunk);
      },
    }),
    createWriteStream(file),
  );
  if (digest && `sha256:${hash.digest('hex')}` !== digest)
    throw new Error(`${url} does not match its published digest`);
}

/** Fetches one install into the cache, when a release has it. */
export async function fetchInstall({
  cache,
  install,
  group,
  index,
  repository,
  scratch,
  fetcher = fetch,
  execute = execFileSync,
  log = console.log,
}) {
  if (!INSTALL.test(install)) throw new Error(`Not an install: ${install}`);
  const name = assetName(group, install);
  const asset = index[name];
  if (!asset) {
    log(`${install}: not released for ${group}; building it`);
    return false;
  }
  mkdirSync(scratch, { recursive: true });
  const bundle = join(scratch, `${asset.tag}.${bundleName}`);
  if (!existsSync(bundle))
    await download(asset.bundle.url, bundle, asset.bundle.digest, { fetcher });
  const file = join(scratch, name);
  log(`${install}: downloading ${asset.tag}/${name}`);
  await download(asset.url, file, asset.digest, { fetcher });
  // Nothing of the archive is read before its attestation is verified.
  execute('gh', verificationArgs(file, bundle, repository, asset.commit), {
    stdio: 'inherit',
  });
  execute(python, [archiveTool, 'unpack', file, cache, install], {
    stdio: 'inherit',
  });
  rmSync(file);
  return true;
}

const output = (values) => {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(''),
  );
};
const forward = (path) => path.replaceAll('\\', '/');
const indexFile = () =>
  join(process.env.RUNNER_TEMP, 'native-deps', 'index.json');
const readIndex = () => JSON.parse(readFileSync(indexFile(), 'utf8'));

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'index') {
    // A job's cache name ([job]), resolved to its group for the job's steps.
    const [job] = args;
    const group = dependencyGroup({
      job,
      platform: process.platform,
      env: process.env,
      version: (compiler) =>
        execFileSync(compiler, ['-dumpversion'], { encoding: 'utf8' })
          .trim()
          .split('.')[0],
    });
    const client = github();
    const assets = releasedIndex(await client.releases());
    mkdirSync(join(process.env.RUNNER_TEMP, 'native-deps'), {
      recursive: true,
    });
    writeFileSync(indexFile(), JSON.stringify({ group, assets }));
    const mine = Object.keys(assets).filter(
      (name) => parseAsset(name).group === group,
    );
    console.log(
      `Native dependency group ${group}: ${mine.length} released installs`,
    );
    appendFileSync(
      process.env.GITHUB_ENV,
      `SOUNDOR_DEPENDENCY_GROUP=${group}\n` +
        `SOUNDOR_DEPENDENCY_FETCH="${forward(process.execPath)}" "${forward(script)}" fetch\n`,
    );
  } else if (command === 'fetch') {
    // CMake's call, with the cache root and the install it is about to build.
    const [cache, install] = args;
    const { group, assets } = readIndex();
    await fetchInstall({
      cache: resolve(cache),
      install,
      group,
      index: assets,
      repository: process.env.GITHUB_REPOSITORY,
      scratch: join(process.env.RUNNER_TEMP, 'native-deps', 'downloads'),
    });
  } else if (command === 'offer') {
    const [out] = args;
    const { group, assets } = readIndex();
    const offered = completeInstalls(process.env.SOUNDOR_CACHE).filter(
      (install) => !assets[assetName(group, install)],
    );
    mkdirSync(out, { recursive: true });
    for (const install of offered)
      execFileSync(
        python,
        [
          archiveTool,
          'pack',
          process.env.SOUNDOR_CACHE,
          install,
          join(out, assetName(group, install)),
        ],
        { stdio: 'inherit' },
      );
    console.log(
      offered.length
        ? `Offering ${offered.length} installs for release:\n  ${offered.join('\n  ')}`
        : `Every install of ${group} is released`,
    );
    output({ count: offered.length });
  } else if (command === 'prepare') {
    // The publish job: the run's offers, less what a release now has.
    const [candidates, out] = args;
    const client = github();
    const releases = await client.releases();
    const assets = releasedIndex(releases);
    mkdirSync(out, { recursive: true });
    const names = existsSync(candidates) ? readdirSync(candidates).sort() : [];
    const kept = [];
    for (const name of names) {
      if (!parseAsset(name))
        throw new Error(`Unexpected native dependency candidate ${name}`);
      if (assets[name]) continue;
      const file = join(candidates, name);
      if (!statSync(file).isFile()) throw new Error(`${name} is not a file`);
      copyFileSync(file, join(out, name));
      kept.push(name);
    }
    const tag = nextTag(releases, recipeHash());
    console.log(
      kept.length
        ? `${tag}: ${kept.length} installs\n  ${kept.join('\n  ')}`
        : 'Every offered install is already released',
    );
    output({ count: kept.length, tag });
  } else if (command === 'publish') {
    const [directory, tag, bundle] = args;
    if (!TAG.test(tag)) throw new Error(`Invalid tag ${tag}`);
    const client = github();
    const names = readdirSync(directory).filter(parseAsset).sort();
    const body = [
      'Skia, ANGLE and Hermes as main CI built them, for CI jobs to fetch',
      'instead of building them again (`.github/scripts/native-deps-release.mjs`).',
      'Not a Soundor release.',
      '',
      ...names.map((name) => {
        const { group, install } = parseAsset(name);
        return `- \`${install}\` (${group})`;
      }),
    ].join('\n');
    const existing = await client.call(
      'GET',
      `/releases/tags/${encodeURIComponent(tag)}`,
    );
    if (existing) throw new Error(`${tag} already exists`);
    let release = await client.call('POST', '/releases', {
      body: {
        tag_name: tag,
        target_commitish: process.env.GITHUB_SHA,
        name: `Native dependencies ${tag.slice('native-deps-'.length)}`,
        body,
        draft: true,
        prerelease: true,
        make_latest: 'false',
      },
    });
    try {
      const upload = release.upload_url.replace(/\{.*\}$/, '');
      for (const [name, file] of [
        ...names.map((name) => [name, join(directory, name)]),
        [bundleName, bundle],
      ])
        await client.call(
          'POST',
          `${upload}?name=${encodeURIComponent(name)}`,
          { body: readFileSync(file), type: 'application/octet-stream' },
        );
      release = await client.call('PATCH', `/releases/${release.id}`, {
        body: { draft: false, make_latest: 'false' },
      });
    } catch (error) {
      // An unpublished draft is never used; leave none behind.
      await client.call('DELETE', `/releases/${release.id}`).catch(() => {});
      throw error;
    }
    const published = await client.call(
      'GET',
      `/releases/tags/${encodeURIComponent(tag)}`,
    );
    const missing = [...names, bundleName].filter(
      (name) => !published?.assets?.some((asset) => asset.name === name),
    );
    if (!published || published.draft || missing.length)
      throw new Error(
        `${tag} did not publish completely: ${missing.join(' ')}`,
      );
    console.log(
      `Published ${published.html_url} (immutable: ${published.immutable ?? 'unknown'})`,
    );
  } else throw new Error('Unknown native dependency release operation');
}
if (process.argv[1] && resolve(process.argv[1]) === script) await main();
