// Makes an executable available, for a source checkout (and, explicitly,
// for an installed package that should build its own):
//
//   prebuilt (default)  the published executable of this exact version, if
//                       its native inputs match these sources; in a source
//                       checkout, a local build otherwise (an unpublished
//                       version, or modified native sources)
//   source              always a local build
//   artifact            a CI artifact (SOUNDOR_VST3_HOST_ARTIFACT), which must
//                       match this checkout exactly; never anything else
//
// A network, registry or integrity failure is an error, never "unpublished".
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';

import { Vst3HostError } from './errors.ts';
import { nativeInputs } from './inputs.ts';
import {
  type Fetch,
  NPM_REGISTRY,
  downloadTarball,
  readTarball,
  versionMetadata,
} from './npm.ts';
import { PROTOCOL_VERSION } from './protocol.ts';
import {
  PROVENANCE_FILE,
  type Provenance,
  checkedProvenance,
  sha256,
  sha256File,
} from './provenance.ts';
import { type Selection, resolveHost, selectionFile } from './resolve.ts';
import {
  type Target,
  currentPlatform,
  describePlatform,
  isSourceWorkspace,
  ownManifest,
  packageRoot,
  targetFor,
} from './targets.ts';

export type BuildMode = 'prebuilt' | 'source';

export interface PrepareOptions {
  mode?: BuildMode;
  /** A CI artifact directory (an executable and its soundor-vst3-host.json).
      Default: SOUNDOR_VST3_HOST_ARTIFACT. */
  artifact?: string;
  /** The commit an artifact must come from. Default: GITHUB_SHA when set. */
  commit?: string;
  /** Default: SOUNDOR_CACHE, else the user cache directory. */
  cache?: string;
  registry?: string;
  fetcher?: Fetch;
  /** Default: console.log. */
  log?: (message: string) => void;
  root?: string;
  /** @internal Replaces the CMake build (tests). */
  build?: (reason: string) => PreparedHost;
}

export interface PreparedHost {
  executable: string;
  mode: 'prebuilt' | 'source' | 'artifact';
  reason: string;
  sourceFingerprint: string;
}

export function cacheRoot(): string {
  if (process.env.SOUNDOR_CACHE) return process.env.SOUNDOR_CACHE;
  if (process.platform === 'win32')
    return join(process.env.LOCALAPPDATA ?? homedir(), 'Soundor', 'cache');
  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Caches', 'Soundor');
  return join(
    process.env.XDG_CACHE_HOME || join(homedir(), '.cache'),
    'soundor',
  );
}

function currentTarget(): Target {
  const platform = currentPlatform();
  const target = targetFor(platform);
  if (!target)
    throw new Vst3HostError(
      'unsupported-platform',
      `@soundor/vst3-host has no executable for ${describePlatform(platform)}`,
    );
  return target;
}

function writeAtomically(
  path: string,
  data: string | Uint8Array,
  mode?: number,
): void {
  const partial = `${path}.${randomUUID()}.part`;
  writeFileSync(partial, data);
  if (mode !== undefined) chmodSync(partial, mode);
  renameSync(partial, path);
}

export async function prepareHost(
  options: PrepareOptions = {},
): Promise<PreparedHost> {
  const root = options.root ?? packageRoot;
  const log = options.log ?? ((message: string) => console.log(message));
  const workspace = isSourceWorkspace(root);
  const target = currentTarget();
  const { fingerprint, version } = nativeInputs(root);
  const artifact = options.artifact ?? process.env.SOUNDOR_VST3_HOST_ARTIFACT;
  const build =
    options.build ??
    ((reason: string) => buildFromSource(root, fingerprint, reason, log));

  const select = (prepared: PreparedHost): PreparedHost => {
    log(
      `VST3 host: ${prepared.executable} (${prepared.mode}: ${prepared.reason})`,
    );
    if (workspace) {
      mkdirSync(join(root, 'build'), { recursive: true });
      const selection: Selection = {
        mode: prepared.mode,
        executable: relative(root, prepared.executable),
        sha256: sha256File(prepared.executable),
        sourceFingerprint: fingerprint,
        version,
        target: target.target,
        reason: prepared.reason,
      };
      writeAtomically(
        selectionFile(root),
        `${JSON.stringify(selection, null, 2)}\n`,
      );
    }
    return prepared;
  };

  if (artifact) {
    const executable = checkArtifact(artifact, {
      target,
      version,
      fingerprint,
      commit: options.commit ?? process.env.GITHUB_SHA,
    });
    return select({
      executable,
      mode: 'artifact',
      reason: `the CI artifact in ${artifact}, matching this checkout`,
      sourceFingerprint: fingerprint,
    });
  }

  const mode = options.mode ?? 'prebuilt';
  if (mode === 'prebuilt' && !workspace) {
    // An installed package: its platform package, nothing else.
    const resolved = resolveHost({ root });
    return {
      executable: resolved.executable,
      mode: 'prebuilt',
      reason: resolved.reason,
      sourceFingerprint: resolved.provenance?.sourceFingerprint ?? fingerprint,
    };
  }

  if (mode === 'prebuilt') {
    const cache = options.cache ?? cacheRoot();
    let published: PreparedHost | 'unpublished' | 'different';
    try {
      published = await publishedExecutable({
        target,
        version,
        fingerprint,
        cache,
        registry: options.registry ?? NPM_REGISTRY,
        fetcher: options.fetcher ?? fetch,
      });
    } catch (error) {
      throw new Vst3HostError(
        'selection-failed',
        `could not check the published VST3 host executable (${(error as Error).message}). Build it instead with mode "source" (pnpm --filter @soundor/vst3-host build:native).`,
        undefined,
        { cause: error },
      );
    }
    if (typeof published === 'object') return select(published);
    const reason =
      published === 'unpublished'
        ? `${target.package}@${version} is not published`
        : `the native sources differ from ${target.package}@${version}'s`;
    log(`VST3 host: building from source (${reason})`);
    return select(build(`${reason}; built from source`));
  }

  return select(build('built from source as requested'));
}

async function publishedExecutable(context: {
  target: Target;
  version: string;
  fingerprint: string;
  cache: string;
  registry: string;
  fetcher: Fetch;
}): Promise<PreparedHost | 'unpublished' | 'different'> {
  const { target, version, fingerprint } = context;
  // npm versions are immutable: a verified download is reused offline.
  const directory = join(
    context.cache,
    'vst3-host',
    'prebuilt',
    version,
    target.target,
  );
  const cachedProvenance = join(directory, PROVENANCE_FILE);
  if (existsSync(cachedProvenance)) {
    const provenance = checkedProvenance(
      JSON.parse(readFileSync(cachedProvenance, 'utf8')),
      cachedProvenance,
    );
    const executable = join(directory, provenance.executable.path);
    if (
      existsSync(executable) &&
      sha256File(executable) === provenance.executable.sha256
    ) {
      if (provenance.sourceFingerprint !== fingerprint) return 'different';
      return {
        executable,
        mode: 'prebuilt',
        reason: `${target.package}@${version}, cached in ${directory}; its native inputs match`,
        sourceFingerprint: fingerprint,
      };
    }
  }

  const metadata = await versionMetadata(target.package, version, context);
  if (metadata === null) return 'unpublished';
  const tarball = await downloadTarball(metadata, context);
  const entries = readTarball(tarball);
  const record = entries.find((entry) => entry.path === PROVENANCE_FILE);
  if (!record)
    throw new Error(`${target.package}@${version} has no ${PROVENANCE_FILE}`);
  const provenance = checkedProvenance(
    JSON.parse(record.data.toString('utf8')),
    `${target.package}@${version}/${PROVENANCE_FILE}`,
  );
  if (
    provenance.version !== version ||
    provenance.target !== target.target ||
    provenance.protocol !== PROTOCOL_VERSION
  )
    throw new Error(
      `${target.package}@${version} describes another build (${provenance.target} ${provenance.version})`,
    );
  const binary = entries.find(
    (entry) => entry.path === provenance.executable.path,
  );
  if (!binary || sha256(binary.data) !== provenance.executable.sha256)
    throw new Error(
      `${target.package}@${version}'s executable does not match its provenance`,
    );
  mkdirSync(join(directory, 'bin'), { recursive: true });
  const executable = join(directory, provenance.executable.path);
  writeAtomically(executable, binary.data, 0o755);
  writeAtomically(cachedProvenance, `${JSON.stringify(provenance, null, 2)}\n`);
  if (provenance.sourceFingerprint !== fingerprint) return 'different';
  return {
    executable,
    mode: 'prebuilt',
    reason: `${target.package}@${version} from npm; its native inputs match`,
    sourceFingerprint: fingerprint,
  };
}

/** A CI artifact: right target, version, sources and commit, intact. */
export function checkArtifact(
  directory: string,
  expected: {
    target: Target;
    version: string;
    fingerprint: string;
    commit?: string;
  },
): string {
  const file = join(directory, PROVENANCE_FILE);
  if (!existsSync(file))
    throw new Vst3HostError(
      'selection-failed',
      `${directory} has no ${PROVENANCE_FILE}`,
    );
  let provenance: Provenance;
  try {
    provenance = checkedProvenance(
      JSON.parse(readFileSync(file, 'utf8')),
      file,
    );
  } catch (error) {
    throw new Vst3HostError('selection-failed', (error as Error).message);
  }
  const problems: string[] = [];
  if (provenance.target !== expected.target.target)
    problems.push(
      `it is for ${provenance.target}, not ${expected.target.target}`,
    );
  if (provenance.version !== expected.version)
    problems.push(
      `it is version ${provenance.version}, not ${expected.version}`,
    );
  if (provenance.protocol !== PROTOCOL_VERSION)
    problems.push(
      `it speaks protocol ${provenance.protocol}, not ${PROTOCOL_VERSION}`,
    );
  if (provenance.sourceFingerprint !== expected.fingerprint)
    problems.push(
      'it was built from other native sources than this checkout has',
    );
  if (expected.commit && provenance.sourceCommit !== expected.commit)
    problems.push(
      `it was built from ${provenance.sourceCommit}, not ${expected.commit}`,
    );
  const executable = join(directory, provenance.executable.path);
  if (!existsSync(executable))
    problems.push(`${provenance.executable.path} is missing`);
  else if (sha256File(executable) !== provenance.executable.sha256)
    problems.push(`${provenance.executable.path} does not match its SHA-256`);
  if (problems.length)
    throw new Vst3HostError(
      'selection-failed',
      `the VST3 host artifact in ${directory} does not match: ${problems.join('; ')}`,
    );
  return executable;
}

/** The build directory for the current toolchain: a build directory keeps
    the compiler and generator it was configured with. */
export function sourceBuildDirectory(root = packageRoot): string {
  const toolchain = [
    process.platform,
    process.arch,
    process.env.CMAKE_GENERATOR ?? '',
    process.env.CC ?? '',
    process.env.CXX ?? '',
    process.env.CMAKE_OSX_ARCHITECTURES ?? '',
  ].join('\0');
  const id = createHash('sha256').update(toolchain).digest('hex').slice(0, 12);
  return join(root, 'build', `host-${id}`);
}

function run(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error)
    throw new Vst3HostError(
      'selection-failed',
      `could not run ${command}: ${result.error.message} (building the VST3 host needs CMake and a C++20 compiler)`,
    );
  if (result.status !== 0)
    throw new Vst3HostError(
      'selection-failed',
      `${command} ${args.join(' ')} failed (exit ${result.status})`,
    );
}

/** An incremental Release build of the executable alone. */
export function buildFromSource(
  root: string,
  fingerprint: string,
  reason: string,
  log: (message: string) => void = console.log,
): PreparedHost {
  const directory = sourceBuildDirectory(root);
  log(`VST3 host: building in ${directory}`);
  run(
    'cmake',
    ['-S', root, '-B', directory, '-DCMAKE_BUILD_TYPE=Release'],
    root,
  );
  run(
    'cmake',
    [
      '--build',
      directory,
      '--config',
      'Release',
      '--target',
      'soundor-vst3-host',
    ],
    root,
  );
  const executable = join(
    directory,
    'bin',
    process.platform === 'win32'
      ? 'soundor-vst3-host.exe'
      : 'soundor-vst3-host',
  );
  if (!existsSync(executable))
    throw new Vst3HostError(
      'selection-failed',
      `the build did not produce ${executable}`,
    );
  return { executable, mode: 'source', reason, sourceFingerprint: fingerprint };
}

/** For the CLI's `inputs` command and the release scripts. */
export function describeInputs(root = packageRoot): {
  fingerprint: string;
  version: string;
  files: string[];
} {
  const manifest = ownManifest(root);
  const inputs = nativeInputs(root);
  return {
    fingerprint: inputs.fingerprint,
    version: manifest.version,
    files: inputs.files,
  };
}
