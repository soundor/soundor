// The VST3 runtime's prebuilt adapters as a GitHub release, as the engine's
// prebuilts are (engine-prebuilts.mjs, whose packing and release code this
// uses): the npm package carries only artifacts/manifest.json, and
// `soundor build vst3` downloads the adapter it links into the Soundor cache
// (runtimes/vst3-runtime/src/adapter.ts). For .github/workflows/vst3.yml and
// release.yml:
//
//   pack <prebuilt> <out>            the staged adapters (prebuilt/<target>-
//                                    <variant>/, `build:native`) as archives
//   plan [--revision <n>]            what to release, or the release to reuse
//   assemble <archives> <out>        build-info.json, SHA256SUMS, notes
//   release <assets> --mode <m>      draft (stage) or publish, then verify
//   manifest --tag <tag> --out <f>   artifacts/manifest.json, from the verified
//                                    public release
//   local-manifest <archives> --out <f>  a manifest of packed archives on
//                                    disk (file:// URLs)
//   check-pack <pack dir> <manifest> the packed tarball carries exactly that,
//                                    and no adapter
//
// The release is named vst3-adapters-v<version>-<short sha>-r<revision>, for
// the runtime's package version. It holds every target's debug and release
// adapter, all built against the one engine the package pins.
// GitHub access: GITHUB_REPOSITORY, GITHUB_TOKEN, GITHUB_API_URL.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  decide as decideRelease,
  digest,
  exists,
  files,
  github,
  manifestText,
  option,
  output,
  packDirectory,
  release as publishRelease,
  verifyRelease,
  write,
} from './engine-prebuilts.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

export const targets = ['linux-x64', 'macos-universal', 'windows-x64'];
export const variants = ['debug', 'release'];
/** What build-info.json must say as the plan does. */
export const identity = ['runtimeVersion', 'sourceCommit', 'revision', 'tag'];

export function adapterLibrary(target) {
  return target === 'windows-x64' ? 'soundor_vst3.lib' : 'libsoundor_vst3.a';
}

export function releaseTag(version, commit, revision) {
  return `vst3-adapters-v${version}-${commit.slice(0, 8)}-r${revision}`;
}

export function archiveName(version, target, variant) {
  return `soundor-vst3-adapter-${version}-${target}-${variant}.tar.gz`;
}

/** Everything a release of <commit> must contain. */
export function plan({ version, commit, revision }) {
  if (!/^[0-9a-f]{40}$/.test(commit))
    throw new Error(
      `An adapter release names its full source commit, not "${commit}"`,
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
    runtimeVersion: version,
    sourceCommit: commit,
    revision,
    tag: releaseTag(version, commit, revision),
    archives,
    assets: [...archives.map((a) => a.file), 'build-info.json', 'SHA256SUMS'],
  };
}

export function runtimeVersion() {
  return JSON.parse(
    readFileSync(join(root, 'runtimes/vst3-runtime/package.json'), 'utf8'),
  ).version;
}

// ── Archives ──────────────────────────────────────────────────────────────

/**
 * Checks a staged adapter (adapter.json, as scripts/adapter.ts writes it)
 * against the runtime version: its target and variant, its library, the VST3
 * SDK's license notice, nothing else.
 */
export function checkStage(stage, version) {
  const metadata = JSON.parse(
    readFileSync(join(stage, 'adapter.json'), 'utf8'),
  );
  const problems = [];
  if (metadata.format !== 1) problems.push('its format is not 1');
  if (metadata.runtimeVersion !== version)
    problems.push(`it is runtime ${metadata.runtimeVersion}, not ${version}`);
  if (!targets.includes(metadata.target))
    problems.push(`its target is ${metadata.target}`);
  if (!variants.includes(metadata.variant))
    problems.push(`its variant is ${metadata.variant}`);
  if (
    typeof metadata.engine?.version !== 'string' ||
    !/^[0-9a-f]{64}$/.test(metadata.engine?.sourceFingerprint ?? '')
  )
    problems.push('it names no engine version and input fingerprint');
  if (problems.length === 0) {
    const library = `lib/${adapterLibrary(metadata.target)}`;
    const present = files(stage);
    if (!present.includes(library)) problems.push(`${library} is missing`);
    if (!present.some((path) => path.startsWith('licenses/vst3sdk/')))
      problems.push('the VST3 SDK license notice is missing');
    const extra = present.filter(
      (path) =>
        path !== 'adapter.json' &&
        path !== library &&
        !path.startsWith('licenses/'),
    );
    if (extra.length)
      problems.push(`it also holds ${extra.slice(0, 5).join(', ')}`);
  }
  if (problems.length)
    throw new Error(
      `${stage} is not a staged adapter of @soundor/vst3-runtime ${version}: ${problems.join('; ')}`,
    );
  return metadata;
}

/**
 * Packs every staged adapter in <prebuilt> (its <target>-<variant>
 * directories) into <out>, each with its sidecar: adapter.json, the source
 * commit, the SHA-256 and size.
 */
export async function pack(prebuilt, out, { version, commit }) {
  if (!/^[0-9a-f]{40}$/.test(commit ?? ''))
    throw new Error('pack --commit <full source commit>');
  const stages = readdirSync(prebuilt).sort();
  if (!stages.length) throw new Error(`No staged adapters in ${prebuilt}`);
  const packed = [];
  for (const name of stages) {
    const stage = join(prebuilt, name);
    const metadata = checkStage(stage, version);
    if (name !== `${metadata.target}-${metadata.variant}`)
      throw new Error(
        `${stage} holds the ${metadata.target} ${metadata.variant} adapter`,
      );
    packed.push(
      await packDirectory(
        stage,
        out,
        archiveName(version, metadata.target, metadata.variant),
        { ...metadata, sourceCommit: commit },
      ),
    );
  }
  return packed;
}

function sidecars(directory) {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.tar.gz.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(directory, name), 'utf8')));
}

/** The one engine every adapter in <list> was built against. */
function sharedEngine(list) {
  const [first] = list;
  for (const sidecar of list)
    if (
      sidecar.engine?.version !== first.engine?.version ||
      sidecar.engine?.sourceFingerprint !== first.engine?.sourceFingerprint
    )
      throw new Error(
        `The adapters were built against different engines: ${first.file} against ${first.engine?.version} (${first.engine?.sourceFingerprint}), ${sidecar.file} against ${sidecar.engine?.version} (${sidecar.engine?.sourceFingerprint})`,
      );
  return {
    version: first.engine.version,
    sourceFingerprint: first.engine.sourceFingerprint,
    ...(first.engine.abiNamespace
      ? { abiNamespace: first.engine.abiNamespace }
      : {}),
  };
}

// ── The release ───────────────────────────────────────────────────────────

/**
 * Checks that <directory> holds exactly the planned archives with their
 * sidecars, recomputes every checksum, and writes build-info.json,
 * SHA256SUMS and release-notes.md into <out>.
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
      `The adapter set is incomplete or mixed: missing ${missing.join(', ') || 'nothing'}; unexpected ${extra.join(', ') || 'nothing'}`,
    );
  const list = [];
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
    if (sidecar.size !== size) problems.push('its size changed');
    if (sidecar.runtimeVersion !== planned.runtimeVersion)
      problems.push(`it is runtime ${sidecar.runtimeVersion}`);
    if (sidecar.sourceCommit !== planned.sourceCommit)
      problems.push(`it was built from ${sidecar.sourceCommit}`);
    if (sidecar.target !== target || sidecar.variant !== variant)
      problems.push(
        `it is the ${sidecar.variant} adapter for ${sidecar.target}`,
      );
    if (problems.length)
      throw new Error(
        `${file} is not the planned archive: ${problems.join('; ')}`,
      );
    list.push(sidecar);
  }
  const buildInfo = {
    format: 1,
    runtimeVersion: planned.runtimeVersion,
    sourceCommit: planned.sourceCommit,
    revision: planned.revision,
    tag: planned.tag,
    engine: sharedEngine(list),
    vst3sdk: list[0].vst3sdk,
    artifacts: list.map((sidecar) => ({
      file: sidecar.file,
      target: sidecar.target,
      variant: sidecar.variant,
      sha256: sidecar.sha256,
      size: sidecar.size,
    })),
  };
  write(
    join(out, 'build-info.json'),
    `${JSON.stringify(buildInfo, null, 2)}\n`,
  );
  writeFileSync(
    join(out, 'SHA256SUMS'),
    buildInfo.artifacts.map((a) => `${a.sha256}  ${a.file}\n`).join(''),
  );
  writeFileSync(join(out, 'release-notes.md'), releaseNotes(buildInfo));
  return buildInfo;
}

export function releaseNotes(info) {
  const rows = info.artifacts.map(
    (a) => `| \`${a.file}\` | ${a.target} | ${a.variant} | \`${a.sha256}\` |`,
  );
  return `The prebuilt VST3 adapters of \`@soundor/vst3-runtime\` ${info.runtimeVersion}: what \`soundor build vst3\` links into a plugin, downloaded (and checked against the package's manifest) on first use. Not an npm release: the runtime's package release is separate.

- Runtime version: \`${info.runtimeVersion}\`
- Engine: \`${info.engine.version}\` (inputs \`${info.engine.sourceFingerprint}\`)
- VST3 SDK: \`${info.vst3sdk}\`
- Source commit: \`${info.sourceCommit}\`
- Build revision: \`r${info.revision}\`

| Archive | Target | Variant | SHA-256 |
| ------- | ------ | ------- | ------- |
${rows.join('\n')}

\`build-info.json\` is the machine-readable form of this table; \`SHA256SUMS\` lists the checksums for \`sha256sum -c\`. Each archive carries the VST3 SDK's license notice in \`licenses/vst3sdk/\`.
`;
}

/** What a run has to do for <commit>: reuse, finish a draft, or release. */
export function decide(client, { version, commit, revision }) {
  return decideRelease(
    client,
    { version, commit, revision },
    {
      prefix: `vst3-adapters-v${version}-${commit.slice(0, 8)}-r`,
      plan,
      identity,
    },
  );
}

export function release(client, directory, planned, { mode, draft }) {
  return publishRelease(client, directory, planned, {
    mode,
    draft,
    title: `VST3 adapters ${planned.runtimeVersion} (${planned.sourceCommit.slice(0, 8)}, r${planned.revision})`,
    identity,
  });
}

// ── The npm release ───────────────────────────────────────────────────────

/**
 * artifacts/manifest.json for the npm package: the archives of the verified,
 * published release (every one downloaded anonymously and checked), with the
 * URLs they are downloaded from and their SHA-256.
 */
export async function manifest(client, found, planned) {
  if (found.draft) throw new Error(`${found.tag_name} is not published`);
  const info = await verifyRelease(client, found, planned, identity);
  return {
    format: 1,
    runtimeVersion: info.runtimeVersion,
    sourceCommit: info.sourceCommit,
    revision: info.revision,
    tag: info.tag,
    release: found.html_url,
    engine: info.engine,
    artifacts: info.artifacts.map((artifact) => ({
      file: artifact.file,
      target: artifact.target,
      variant: artifact.variant,
      sha256: artifact.sha256,
      size: artifact.size,
      url: found.assets.find((a) => a.name === artifact.file)
        .browser_download_url,
    })),
  };
}

/** A manifest of the archives `pack` wrote into <directory>, by file:// URL. */
export function localManifest(directory, { version, commit } = {}) {
  const list = sidecars(directory);
  if (!list.length) throw new Error(`No packed adapters in ${directory}`);
  const [first] = list;
  for (const sidecar of list)
    if (
      sidecar.runtimeVersion !== (version ?? first.runtimeVersion) ||
      sidecar.sourceCommit !== (commit ?? first.sourceCommit)
    )
      throw new Error(
        'Local adapter archives have mixed versions or belong to another commit',
      );
  return {
    format: 1,
    runtimeVersion: first.runtimeVersion,
    sourceCommit: first.sourceCommit,
    revision: 0,
    tag: 'local',
    release: null,
    engine: sharedEngine(list),
    artifacts: list.map((sidecar) => ({
      file: sidecar.file,
      target: sidecar.target,
      variant: sidecar.variant,
      sha256: sidecar.sha256,
      size: sidecar.size,
      url: pathToFileURL(join(directory, sidecar.file)).href,
    })),
  };
}

/**
 * Checks the @soundor/vst3-runtime tarball Changesets packed into
 * <directory>: its version, exactly <expected> as artifacts/manifest.json,
 * and no adapter (nor any other build output).
 */
export function checkPack(directory, expected) {
  const tarballs = files(directory).filter((path) =>
    /(^|\/)soundor-vst3-runtime-[^/]*\.tgz$/.test(path),
  );
  if (tarballs.length !== 1)
    throw new Error(
      `Expected one packed @soundor/vst3-runtime in ${directory}, found ${tarballs.length}`,
    );
  const tarball = join(directory, tarballs[0]);
  const read = (member) =>
    execFileSync('tar', ['-xzOf', tarball, member], { encoding: 'utf8' });
  const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const version = JSON.parse(read('package/package.json')).version;
  if (version !== expected.runtimeVersion)
    throw new Error(
      `The packed VST3 runtime is ${version}, not ${expected.runtimeVersion}`,
    );
  if (!entries.includes('package/artifacts/manifest.json'))
    throw new Error('The packed VST3 runtime has no artifacts/manifest.json');
  if (read('package/artifacts/manifest.json') !== manifestText(expected))
    throw new Error(
      'The packed VST3 runtime carries another artifacts/manifest.json',
    );
  const built = entries.filter((entry) =>
    /\.(a|lib|o|obj|so|dylib|dll|tar\.gz)$|^package\/prebuilt\//.test(entry),
  );
  if (built.length)
    throw new Error(
      `The packed VST3 runtime contains build output: ${built.slice(0, 5).join(', ')}`,
    );
  return tarballs[0];
}

// ── Command line ──────────────────────────────────────────────────────────

async function main([command, ...args]) {
  const version = runtimeVersion();
  const commit = option(args, 'commit') ?? process.env.GITHUB_SHA;
  const revisionText = option(args, 'revision');
  const revision = revisionText ? Number(revisionText) : undefined;
  const planned = () => plan({ version, commit, revision: revision ?? 1 });
  const fromTag = () => {
    const tag = option(args, 'tag');
    const tagged = /-r(\d+)$/.exec(tag ?? '');
    if (!tagged)
      throw new Error(
        `${command} --tag vst3-adapters-v<version>-<sha>-r<revision>`,
      );
    const expected = plan({ version, commit, revision: Number(tagged[1]) });
    if (expected.tag !== tag)
      throw new Error(`${tag} is not a release of ${version} at ${commit}`);
    return expected;
  };
  switch (command) {
    case 'pack': {
      for (const sidecar of await pack(args[0], args[1], { version, commit }))
        console.log(
          `${sidecar.file}: ${sidecar.size} bytes, SHA-256 ${sidecar.sha256}`,
        );
      break;
    }
    case 'plan': {
      const decision = await decide(github(), { version, commit, revision });
      output({
        action: decision.action,
        tag: decision.plan.tag,
        draft: decision.draft ?? '',
        version,
        revision: decision.plan.revision,
      });
      break;
    }
    case 'assemble': {
      const info = await assemble(args[0], args[1], planned());
      console.log(
        `build-info.json: ${info.artifacts.length} adapters for ${info.tag}`,
      );
      break;
    }
    case 'release': {
      const result = await release(github(), args[0], planned(), {
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
    case 'manifest': {
      const expected = fromTag();
      const client = github();
      const found = await client.call(
        'GET',
        `/releases/tags/${encodeURIComponent(expected.tag)}`,
      );
      if (!found)
        throw new Error(`There is no published release ${expected.tag}`);
      const value = await manifest(client, found, expected);
      write(option(args, 'out'), manifestText(value));
      console.log(
        `${option(args, 'out')}: ${value.artifacts.length} adapters of ${expected.tag}`,
      );
      break;
    }
    case 'local-manifest': {
      const value = localManifest(args[0], {
        version,
        commit: option(args, 'commit'),
      });
      write(option(args, 'out'), manifestText(value));
      console.log(
        `${option(args, 'out')}: ${value.artifacts.length} local adapters`,
      );
      break;
    }
    case 'check-pack': {
      if (!exists(args[1])) throw new Error(`${args[1]} does not exist`);
      const tarball = checkPack(
        args[0],
        JSON.parse(readFileSync(args[1], 'utf8')),
      );
      console.log(`${tarball} carries the manifest of the verified release`);
      break;
    }
    default:
      throw new Error(
        'usage: vst3-adapters.mjs pack|plan|assemble|release|manifest|local-manifest|check-pack ...',
      );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  await main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
