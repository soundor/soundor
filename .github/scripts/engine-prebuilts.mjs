// Engine prebuilt releases (runtimes/engine/README.md, "Prebuilt engines"),
// for .github/workflows/engine-prebuilts.yml:
//
//   plan [--revision <n>]            what to build, or the release to reuse
//   pack <stage> <out>               a staged engine as a verified archive
//   assemble <artifacts> <out>       build-info.json, SHA256SUMS, notes
//   release <assets> --mode <m>      draft (stage) or publish, then verify
//   verify --tag <tag>               a published release, downloaded anonymously
//
// and for .github/workflows/release.yml, when @soundor/engine is published:
//
//   planned-engine <publish plan>    whether the Changesets plan publishes it
//   manifest --tag <tag> --out <f>   its artifacts/manifest.json, from the
//                                    verified public release
//   check-pack <pack dir> <manifest> the packed tarball carries exactly that
//   local-manifest <archives> --out <f>  a manifest of packed archives on disk
//                                    (file:// URLs), to build plugins with
//                                    them before any release exists
//
// The release is named engine-prebuilts-v<version>-<short sha>-r<revision>.
// GitHub access: GITHUB_REPOSITORY, GITHUB_TOKEN, GITHUB_API_URL.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGzip } from 'node:zlib';

const root = fileURLToPath(new URL('../../', import.meta.url));

export const targets = ['macos-universal', 'linux-x64', 'windows-x64'];
export const variants = ['debug', 'release'];
// Hermes's compiler: only the debug engine links it.
const compilerLibraries =
  /hermes(Parser|Frontend|AST|Optimizer|Backend|SourceMap)\b/;

/** The engine's ABI namespace (cmake/SoundorAbi.cmake): 0.2.1 -> v0_2_1. */
export function abiNamespace(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(version);
  if (!match) throw new Error(`Invalid engine package version: ${version}`);
  const suffix = match[4] ? `_p${Buffer.from(match[4]).toString('hex')}` : '';
  return `v${match[1]}_${match[2]}_${match[3]}${suffix}`;
}

export function releaseTag(version, commit, revision) {
  return `engine-prebuilts-v${version}-${commit.slice(0, 8)}-r${revision}`;
}

export function archiveName(version, target, variant) {
  return `soundor-engine-${version}-${target}-${variant}.tar.gz`;
}

/** Everything a release of <commit> must contain, before anything is built. */
export function plan({ version, commit, revision }) {
  if (!/^[0-9a-f]{40}$/.test(commit))
    throw new Error(
      `A prebuilt release names its full source commit, not "${commit}"`,
    );
  if (!Number.isInteger(revision) || revision < 1)
    throw new Error(
      `The build revision is a positive integer, not "${revision}"`,
    );
  const archives = targets.flatMap((target) =>
    variants.map((variant) => ({
      file: archiveName(version, target, variant),
      target,
      variant,
    })),
  );
  return {
    engineVersion: version,
    abiNamespace: abiNamespace(version),
    sourceCommit: commit,
    revision,
    tag: releaseTag(version, commit, revision),
    archives,
    assets: [...archives.map((a) => a.file), 'build-info.json', 'SHA256SUMS'],
  };
}

export function engineVersion() {
  return JSON.parse(
    readFileSync(join(root, 'runtimes/engine/package.json'), 'utf8'),
  ).version;
}

// ── Archives ──────────────────────────────────────────────────────────────

/** Checks a staged engine (soundor-engine.json) against what was planned. */
export function checkStage(stage, expected) {
  const metadata = JSON.parse(
    readFileSync(join(stage, 'soundor-engine.json'), 'utf8'),
  );
  const problems = [];
  const expect = (what, actual, wanted) => {
    if (actual !== wanted)
      problems.push(
        `${what} is ${JSON.stringify(actual)}, not ${JSON.stringify(wanted)}`,
      );
  };
  expect('format', metadata.format, 1);
  expect('engine.version', metadata.engine?.version, expected.engineVersion);
  expect(
    'engine.abiNamespace',
    metadata.engine?.abiNamespace,
    expected.abiNamespace,
  );
  expect(
    'engine.sourceCommit',
    metadata.engine?.sourceCommit,
    expected.sourceCommit,
  );
  if (expected.target)
    expect('target.name', metadata.target?.name, expected.target);
  if (!targets.includes(metadata.target?.name))
    problems.push(`target ${metadata.target?.name} is not a prebuilt target`);
  if (!variants.includes(metadata.variant))
    problems.push(`variant ${metadata.variant} is not a prebuilt variant`);
  const debug = metadata.variant === 'debug';
  expect('configuration', metadata.configuration, debug ? 'Debug' : 'Release');
  expect('features.devtools', metadata.features?.devtools, debug);
  expect('features.jsSource', metadata.features?.jsSource, debug);
  if (metadata.target?.name === 'macos-universal')
    expect(
      'target.architectures',
      metadata.target.architectures?.join(','),
      'arm64,x64',
    );
  if (metadata.target?.os === 'windows')
    expect(
      'toolchain.msvcRuntime',
      metadata.toolchain?.msvcRuntime,
      debug ? 'MultiThreadedDebugDLL' : 'MultiThreadedDLL',
    );
  const link = metadata.link ?? {};
  for (const group of ['engine', 'hermes', 'skia', 'angle', 'accessKit'])
    for (const file of link[group] ?? [])
      if (!exists(join(stage, file))) problems.push(`${file} is missing`);
  if (!link.engine?.length || !link.hermes?.length || !link.skia?.length)
    problems.push('the engine, Hermes and Skia libraries are not all listed');
  const compiler = (link.hermes ?? []).filter((file) =>
    compilerLibraries.test(file),
  );
  if (!debug && compiler.length)
    problems.push(
      `the release engine links Hermes's compiler (${compiler.join(', ')})`,
    );
  if (debug && !compiler.length)
    problems.push("the debug engine does not link Hermes's compiler");
  if (!exists(join(stage, metadata.hermes?.compiler ?? 'missing')))
    problems.push('hermesc is missing');
  for (const component of [
    'engine',
    'hermes',
    'ada',
    'yoga',
    'skia',
    ...(metadata.features?.gpu ? ['angle'] : []),
    ...(metadata.features?.accessKit ? ['accesskit'] : []),
  ])
    if (!files(join(stage, 'licenses', component)).length)
      problems.push(`no license notice for ${component}`);
  if (problems.length)
    throw new Error(
      `The staged engine in ${stage} is not the planned one:\n  ${problems.join('\n  ')}`,
    );
  return metadata;
}

function exists(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Every file under <directory>, sorted, as paths relative to it ("/"). */
function files(directory, base = directory) {
  if (!exists(directory)) return [];
  return readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const path = join(directory, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink())
        throw new Error(
          `${path} is a symbolic link: prebuilt archives hold files only`,
        );
      return stat.isDirectory()
        ? files(path, base)
        : [relative(base, path).split(sep).join('/')];
    });
}

// A ustar header; names longer than ustar holds get a PAX "path" record.
function header(name, size, mode, type = '0') {
  const block = Buffer.alloc(512);
  const field = (offset, length, value) =>
    block.write(value, offset, length, 'utf8');
  const octal = (offset, length, value) =>
    field(offset, length, value.toString(8).padStart(length - 1, '0') + '\0');
  field(0, 100, name.slice(0, 100));
  octal(100, 8, mode);
  octal(108, 8, 0); // uid
  octal(116, 8, 0); // gid
  octal(124, 12, size);
  octal(136, 12, 0); // mtime: fixed, the archive depends on its contents only
  block.fill(' ', 148, 156);
  field(156, 1, type);
  field(257, 6, 'ustar\0');
  field(263, 2, '00');
  let sum = 0;
  for (const byte of block) sum += byte;
  field(148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
  return block;
}

function* entry(name, contents, mode) {
  if (Buffer.byteLength(name) > 100) {
    // "<length> path=<name>\n", where <length> counts its own digits too.
    const body = ` path=${name}\n`;
    const bodyLength = Buffer.byteLength(body);
    let length = bodyLength + 1;
    while (String(length).length + bodyLength !== length)
      length = String(length).length + bodyLength;
    const pax = Buffer.from(`${length}${body}`);
    yield header(`PaxHeader/${name.slice(-80)}`, pax.length, 0o644, 'x');
    yield pax;
    yield Buffer.alloc((512 - (pax.length % 512)) % 512);
  }
  yield header(name, contents.length, mode);
  yield contents;
  yield Buffer.alloc((512 - (contents.length % 512)) % 512);
}

/**
 * Packs <stage> as <out>/<archive name>, deterministically (sorted entries,
 * fixed times and owners), with a sidecar <archive>.json: its metadata,
 * size and SHA-256.
 */
export async function pack(stage, out, expected) {
  const metadata = checkStage(stage, expected);
  const file = archiveName(
    metadata.engine.version,
    metadata.target.name,
    metadata.variant,
  );
  const top = file.replace(/\.tar\.gz$/, '');
  mkdirSync(out, { recursive: true });
  const executable = new Set([metadata.hermes.compiler]);
  async function* tar() {
    for (const path of files(stage)) {
      const contents = readFileSync(join(stage, path));
      yield* entry(
        `${top}/${path}`,
        contents,
        executable.has(path) ? 0o755 : 0o644,
      );
    }
    yield Buffer.alloc(1024);
  }
  const archive = join(out, file);
  await pipeline(tar, createGzip({ level: 9 }), createWriteStream(archive));
  const { sha256, size } = await digest(archive);
  const sidecar = { file, sha256, size, ...metadata };
  writeFileSync(`${archive}.json`, `${JSON.stringify(sidecar, null, 2)}\n`);
  return sidecar;
}

export async function digest(path) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { sha256: hash.digest('hex'), size };
}

// ── The release ───────────────────────────────────────────────────────────

/**
 * Checks that <directory> holds exactly the planned archives with their
 * sidecars, recomputes every checksum, and writes build-info.json,
 * SHA256SUMS and release-notes.md (all from the same data) into <out>.
 */
export async function assemble(directory, out, planned) {
  const found = readdirSync(directory).filter((name) =>
    name.endsWith('.tar.gz'),
  );
  const wanted = planned.archives.map((a) => a.file);
  const missing = wanted.filter((name) => !found.includes(name));
  const extra = found.filter((name) => !wanted.includes(name));
  if (missing.length || extra.length)
    throw new Error(
      `The prebuilt set is incomplete or mixed: missing ${missing.join(', ') || 'nothing'}; unexpected ${extra.join(', ') || 'nothing'}`,
    );
  const artifacts = [];
  for (const { file, target, variant } of planned.archives) {
    const sidecar = JSON.parse(
      readFileSync(join(directory, `${file}.json`), 'utf8'),
    );
    const { sha256, size } = await digest(join(directory, file));
    const problems = [];
    if (sidecar.file !== file)
      problems.push(`its sidecar names ${sidecar.file}`);
    if (sidecar.sha256 !== sha256)
      problems.push(
        `its SHA-256 is ${sha256}, its sidecar says ${sidecar.sha256}`,
      );
    if (sidecar.size !== size) problems.push(`its size changed`);
    if (sidecar.engine?.version !== planned.engineVersion)
      problems.push(`it is engine ${sidecar.engine?.version}`);
    if (sidecar.engine?.abiNamespace !== planned.abiNamespace)
      problems.push(`its ABI namespace is ${sidecar.engine?.abiNamespace}`);
    if (sidecar.engine?.sourceCommit !== planned.sourceCommit)
      problems.push(`it was built from ${sidecar.engine?.sourceCommit}`);
    if (sidecar.target?.name !== target || sidecar.variant !== variant)
      problems.push(
        `it is the ${sidecar.variant} engine for ${sidecar.target?.name}`,
      );
    if (problems.length)
      throw new Error(
        `${file} is not the planned archive: ${problems.join('; ')}`,
      );
    artifacts.push({
      file,
      target,
      os: sidecar.target.os,
      architectures: sidecar.target.architectures,
      minimumOsVersion: sidecar.target.minimumOsVersion || null,
      variant,
      configuration: sidecar.configuration,
      sha256,
      size,
      toolchain: sidecar.toolchain,
      features: sidecar.features,
      hermes: {
        revision: sidecar.hermes.revision,
        bytecodeVersion: sidecar.hermes.bytecodeVersion,
      },
    });
  }
  const buildInfo = {
    format: 1,
    engineVersion: planned.engineVersion,
    abiNamespace: planned.abiNamespace,
    sourceCommit: planned.sourceCommit,
    revision: planned.revision,
    tag: planned.tag,
    artifacts,
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, 'build-info.json'),
    `${JSON.stringify(buildInfo, null, 2)}\n`,
  );
  writeFileSync(
    join(out, 'SHA256SUMS'),
    artifacts.map((a) => `${a.sha256}  ${a.file}\n`).join(''),
  );
  writeFileSync(join(out, 'release-notes.md'), releaseNotes(buildInfo));
  return buildInfo;
}

export function releaseNotes(info) {
  const rows = info.artifacts.map(
    (a) =>
      `| \`${a.file}\` | ${a.target} (${a.architectures.join(', ')}${a.minimumOsVersion ? `, macOS ${a.minimumOsVersion}+` : ''}) | ${a.variant} | ${a.toolchain.compiler} ${a.toolchain.compilerVersion}${a.toolchain.msvcRuntime ? `, ${a.toolchain.msvcRuntime}` : ''} | \`${a.sha256}\` |`,
  );
  return `Native libraries of \`@soundor/engine\` ${info.engineVersion}, for \`juceRuntime({ engine: { mode: "prebuilt" } })\`. Not an npm release: the engine's package release is separate.

- Engine version: \`${info.engineVersion}\`
- ABI namespace: \`soundor::${info.abiNamespace}\`
- Source commit: \`${info.sourceCommit}\`
- Build revision: \`r${info.revision}\`

| Archive | Target | Variant | Toolchain | SHA-256 |
| ------- | ------ | ------- | --------- | ------- |
${rows.join('\n')}

\`build-info.json\` is the machine-readable form of this table; \`SHA256SUMS\` lists the checksums for \`sha256sum -c\`. Each archive carries the license notices of everything it links in \`licenses/\`. JUCE is not part of the engine.
`;
}

// ── GitHub ────────────────────────────────────────────────────────────────

export function github({
  repository = process.env.GITHUB_REPOSITORY,
  token = process.env.GITHUB_TOKEN,
  api = process.env.GITHUB_API_URL ?? 'https://api.github.com',
  fetch: request = globalThis.fetch,
} = {}) {
  if (!repository) throw new Error('GITHUB_REPOSITORY is not set');
  const headers = (extra = {}, authenticated = true) => ({
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'soundor-engine-prebuilts',
    ...(authenticated && token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  });
  async function call(method, path, { body, extra, authenticated, raw } = {}) {
    const url = path.startsWith('http')
      ? path
      : `${api}/repos/${repository}${path}`;
    const response = await request(url, {
      method,
      headers: headers(extra, authenticated),
      body:
        body === undefined || Buffer.isBuffer(body)
          ? body
          : JSON.stringify(body),
      redirect: 'follow',
    });
    if (raw) return response;
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(
        `${method} ${url}: ${response.status} ${await response.text()}`,
      );
    return response.status === 204 ? true : response.json();
  }
  return {
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

/** Downloads a release asset; anonymously from its public URL when published. */
async function download(client, release, asset) {
  const response = release.draft
    ? await client.call('GET', `/releases/assets/${asset.id}`, {
        extra: { Accept: 'application/octet-stream' },
        raw: true,
      })
    : await client.call('GET', asset.browser_download_url, {
        authenticated: false,
        raw: true,
      });
  if (!response.ok)
    throw new Error(`Downloading ${asset.name} failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Verifies a release against <planned>: exactly the planned assets, a
 * build-info.json that names the same engine, commit and revision, and every
 * archive's SHA-256 (downloaded, and GitHub's own digest where it has one).
 */
export async function verifyRelease(client, release, planned) {
  const names = release.assets.map((a) => a.name).sort();
  const wanted = [...planned.assets].sort();
  if (names.join('\n') !== wanted.join('\n'))
    throw new Error(
      `${release.tag_name} has the assets ${names.join(', ')}, not ${wanted.join(', ')}`,
    );
  const asset = (name) => release.assets.find((a) => a.name === name);
  const info = JSON.parse(
    (await download(client, release, asset('build-info.json'))).toString(
      'utf8',
    ),
  );
  for (const key of [
    'engineVersion',
    'abiNamespace',
    'sourceCommit',
    'revision',
    'tag',
  ])
    if (info[key] !== planned[key])
      throw new Error(
        `${release.tag_name}: build-info.json says ${key} ${info[key]}, not ${planned[key]}`,
      );
  for (const { file } of planned.archives) {
    const artifact = info.artifacts.find((a) => a.file === file);
    if (!artifact)
      throw new Error(
        `${release.tag_name}: build-info.json does not list ${file}`,
      );
    const reported = asset(file).digest;
    if (reported && reported !== `sha256:${artifact.sha256}`)
      throw new Error(
        `${release.tag_name}: GitHub's digest of ${file} is ${reported}, build-info.json says ${artifact.sha256}`,
      );
    const contents = await download(client, release, asset(file));
    const actual = createHash('sha256').update(contents).digest('hex');
    if (actual !== artifact.sha256)
      throw new Error(
        `${release.tag_name}: ${file} has SHA-256 ${actual}, build-info.json says ${artifact.sha256}`,
      );
  }
  return info;
}

/**
 * What a run has to do for <commit>: reuse its published release (verified),
 * finish a draft of it, or build. Without an explicit revision, the highest
 * published revision is reused, else revision 1 is built.
 */
export async function decide(client, { version, commit, revision }) {
  const prefix = `engine-prebuilts-v${version}-${commit.slice(0, 8)}-r`;
  const releases = (await client.releases()).filter((r) =>
    r.tag_name?.startsWith(prefix),
  );
  const revisionOf = (r) => Number(r.tag_name.slice(prefix.length));
  let chosen = revision;
  if (chosen === undefined) {
    const published = releases.filter((r) => !r.draft).map(revisionOf);
    chosen = published.length ? Math.max(...published) : 1;
  }
  const planned = plan({ version, commit, revision: chosen });
  const release = releases.find((r) => r.tag_name === planned.tag);
  if (!release) return { action: 'build', plan: planned };
  if (release.draft)
    return { action: 'build', plan: planned, draft: release.id };
  // Published releases are immutable: never rebuilt over. A wrong one needs a
  // higher revision.
  await verifyRelease(client, release, planned);
  return { action: 'reuse', plan: planned, url: release.html_url };
}

/**
 * Uploads <directory>'s assets to the planned draft (created or reused; only a
 * draft's assets are ever replaced), verifies it, and in "publish" mode
 * publishes it (never as the repository's latest release) and verifies the
 * public assets anonymously. "stage" mode deletes the verified draft.
 */
export async function release(client, directory, planned, { mode, draft }) {
  if (!['stage', 'publish'].includes(mode))
    throw new Error(`Unknown release mode ${mode}`);
  const notes = readFileSync(join(directory, 'release-notes.md'), 'utf8');
  let current = draft ? await client.call('GET', `/releases/${draft}`) : null;
  if (current && !current.draft)
    throw new Error(`${planned.tag} is already published`);
  if (!current)
    current = await client.call('POST', '/releases', {
      body: {
        tag_name: planned.tag,
        target_commitish: planned.sourceCommit,
        name: `Engine prebuilts ${planned.engineVersion} (${planned.sourceCommit.slice(0, 8)}, r${planned.revision})`,
        body: notes,
        draft: true,
        prerelease: false,
        make_latest: 'false',
      },
    });
  for (const name of planned.assets) {
    const existing = current.assets?.find((a) => a.name === name);
    if (existing)
      await client.call('DELETE', `/releases/assets/${existing.id}`);
    const contents = readFileSync(join(directory, name));
    const upload =
      current.upload_url.replace(/\{.*\}$/, '') +
      `?name=${encodeURIComponent(name)}`;
    await client.call('POST', upload, {
      body: contents,
      extra: {
        'Content-Type': name.endsWith('.json')
          ? 'application/json'
          : 'application/octet-stream',
      },
    });
  }
  current = await client.call('GET', `/releases/${current.id}`);
  await verifyRelease(client, current, planned);
  if (mode === 'stage') {
    await client.call('DELETE', `/releases/${current.id}`);
    return { staged: true };
  }
  await client.call('PATCH', `/releases/${current.id}`, {
    body: { draft: false, make_latest: 'false', body: notes },
  });
  const published = await client.call(
    'GET',
    `/releases/tags/${encodeURIComponent(planned.tag)}`,
  );
  if (!published || published.draft)
    throw new Error(`${planned.tag} did not publish`);
  await verifyRelease(client, published, planned);
  return {
    published: true,
    url: published.html_url,
    immutable: published.immutable ?? null,
  };
}

// ── The npm release ───────────────────────────────────────────────────────

/**
 * The version of @soundor/engine a Changesets publish plan (`changeset
 * publish-plan --output`) publishes, or null when it publishes none.
 */
export function plannedEngine(publishPlan) {
  if (publishPlan?.version !== 1 || !Array.isArray(publishPlan.plan))
    throw new Error('Unknown Changesets publish plan format');
  const entry = publishPlan.plan
    .flat()
    .find((e) => e.kind === 'publish' && e.name === '@soundor/engine');
  return entry ? entry.version : null;
}

/**
 * artifacts/manifest.json for the npm package: the archives of the verified,
 * published prebuilt release (every one downloaded anonymously and checked),
 * with the URLs they are downloaded from and their SHA-256.
 */
export async function manifest(client, release, planned) {
  if (release.draft) throw new Error(`${release.tag_name} is not published`);
  const info = await verifyRelease(client, release, planned);
  return {
    format: 1,
    engineVersion: info.engineVersion,
    abiNamespace: info.abiNamespace,
    sourceCommit: info.sourceCommit,
    revision: info.revision,
    tag: info.tag,
    release: release.html_url,
    artifacts: info.artifacts.map((artifact) => ({
      file: artifact.file,
      target: artifact.target,
      variant: artifact.variant,
      os: artifact.os,
      architectures: artifact.architectures,
      minimumOsVersion: artifact.minimumOsVersion,
      sha256: artifact.sha256,
      size: artifact.size,
      url: release.assets.find((a) => a.name === artifact.file)
        .browser_download_url,
    })),
  };
}

/** A manifest of the archives `pack` wrote into <directory>, by file:// URL. */
export function localManifest(directory) {
  const sidecars = readdirSync(directory)
    .filter((name) => name.endsWith('.tar.gz.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(directory, name), 'utf8')));
  if (!sidecars.length) throw new Error(`No packed archives in ${directory}`);
  const [first] = sidecars;
  return {
    format: 1,
    engineVersion: first.engine.version,
    abiNamespace: first.engine.abiNamespace,
    sourceCommit: first.engine.sourceCommit,
    revision: 0,
    tag: 'local',
    release: null,
    artifacts: sidecars.map((sidecar) => ({
      file: sidecar.file,
      target: sidecar.target.name,
      variant: sidecar.variant,
      os: sidecar.target.os,
      architectures: sidecar.target.architectures,
      minimumOsVersion: sidecar.target.minimumOsVersion || null,
      sha256: sidecar.sha256,
      size: sidecar.size,
      url: pathToFileURL(join(directory, sidecar.file)).href,
    })),
  };
}

export function manifestText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Checks the @soundor/engine tarball Changesets packed into <directory>: its
 * version, exactly <expected> as artifacts/manifest.json, and no native
 * build output.
 */
export function checkPack(directory, expected) {
  const tarballs = files(directory).filter((path) =>
    /(^|\/)soundor-engine-[^/]*\.tgz$/.test(path),
  );
  if (tarballs.length !== 1)
    throw new Error(
      `Expected one packed @soundor/engine in ${directory}, found ${tarballs.length}`,
    );
  const tarball = join(directory, tarballs[0]);
  const read = (member) =>
    execFileSync('tar', ['-xzOf', tarball, member], { encoding: 'utf8' });
  const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const version = JSON.parse(read('package/package.json')).version;
  if (version !== expected.engineVersion)
    throw new Error(
      `The packed engine is ${version}, not ${expected.engineVersion}`,
    );
  if (!entries.includes('package/artifacts/manifest.json'))
    throw new Error('The packed engine has no artifacts/manifest.json');
  if (read('package/artifacts/manifest.json') !== manifestText(expected))
    throw new Error(
      'The packed engine carries another artifacts/manifest.json',
    );
  const built = entries.filter((entry) =>
    /\.(a|lib|o|obj|so|dylib|dll|tar\.gz)$|\/build\//.test(entry),
  );
  if (built.length)
    throw new Error(
      `The packed engine contains build output: ${built.slice(0, 5).join(', ')}`,
    );
  return tarballs[0];
}

// ── Command line ──────────────────────────────────────────────────────────

function option(args, name) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function output(values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  if (process.env.GITHUB_OUTPUT)
    writeFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`, {
      flag: 'a',
    });
  console.log(lines.join('\n'));
}

async function main([command, ...args]) {
  const version = engineVersion();
  const commit = option(args, 'commit') ?? process.env.GITHUB_SHA;
  const revisionText = option(args, 'revision');
  const revision = revisionText ? Number(revisionText) : undefined;
  const planFile = option(args, 'plan');
  const planned = () =>
    planFile
      ? JSON.parse(readFileSync(planFile, 'utf8'))
      : plan({ version, commit, revision: revision ?? 1 });
  switch (command) {
    case 'plan': {
      const decision = await decide(github(), { version, commit, revision });
      if (option(args, 'out'))
        writeFileSync(
          option(args, 'out'),
          `${JSON.stringify(decision.plan, null, 2)}\n`,
        );
      output({
        action: decision.action,
        tag: decision.plan.tag,
        draft: decision.draft ?? '',
        version,
        revision: decision.plan.revision,
      });
      break;
    }
    case 'pack': {
      const sidecar = await pack(args[0], args[1], {
        ...planned(),
        target: option(args, 'target'),
      });
      console.log(
        `${sidecar.file}: ${sidecar.size} bytes, SHA-256 ${sidecar.sha256}`,
      );
      break;
    }
    case 'assemble': {
      const info = await assemble(args[0], args[1], planned());
      console.log(
        `build-info.json: ${info.artifacts.length} archives for ${info.tag}`,
      );
      break;
    }
    case 'release': {
      const directory = args[0];
      const result = await release(github(), directory, planned(), {
        mode: option(args, 'mode'),
        draft: option(args, 'draft') || undefined,
      });
      output(
        Object.fromEntries(
          Object.entries(result).map(([k, v]) => [k, String(v)]),
        ),
      );
      break;
    }
    case 'verify': {
      const tag = option(args, 'tag');
      const tagged = /-r(\d+)$/.exec(tag ?? '');
      if (!tagged)
        throw new Error(
          'verify --tag engine-prebuilts-v<version>-<sha>-r<revision>',
        );
      const expected = plan({ version, commit, revision: Number(tagged[1]) });
      const client = github();
      const found = await client.call(
        'GET',
        `/releases/tags/${encodeURIComponent(tag)}`,
      );
      if (!found) throw new Error(`There is no published release ${tag}`);
      if (expected.tag !== tag)
        throw new Error(`${tag} is not a release of ${commit}`);
      await verifyRelease(client, found, expected);
      console.log(
        `${tag} is complete and every archive matches build-info.json`,
      );
      break;
    }
    case 'planned-engine': {
      const planned = plannedEngine(JSON.parse(readFileSync(args[0], 'utf8')));
      if (planned !== null && planned !== version)
        throw new Error(
          `The publish plan publishes @soundor/engine ${planned}, the checkout is ${version}`,
        );
      output({ engine: planned !== null, version });
      break;
    }
    case 'manifest': {
      const tag = option(args, 'tag');
      const tagged = /-r(\d+)$/.exec(tag ?? '');
      if (!tagged)
        throw new Error(
          'manifest --tag engine-prebuilts-v<version>-<sha>-r<revision>',
        );
      const expected = plan({ version, commit, revision: Number(tagged[1]) });
      if (expected.tag !== tag)
        throw new Error(`${tag} is not a release of ${commit}`);
      const client = github();
      const found = await client.call(
        'GET',
        `/releases/tags/${encodeURIComponent(tag)}`,
      );
      if (!found) throw new Error(`There is no published release ${tag}`);
      const value = await manifest(client, found, expected);
      write(option(args, 'out'), manifestText(value));
      console.log(
        `${option(args, 'out')}: ${value.artifacts.length} archives of ${tag}`,
      );
      break;
    }
    case 'local-manifest': {
      const value = localManifest(args[0]);
      write(option(args, 'out'), manifestText(value));
      console.log(
        `${option(args, 'out')}: ${value.artifacts.length} local archives`,
      );
      break;
    }
    case 'check-pack': {
      const tarball = checkPack(
        args[0],
        JSON.parse(readFileSync(args[1], 'utf8')),
      );
      console.log(
        `${tarball} carries the manifest of the verified prebuilt release`,
      );
      break;
    }
    default:
      throw new Error(
        'usage: engine-prebuilts.mjs plan|pack|assemble|release|verify|planned-engine|manifest|check-pack ...',
      );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  await main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
