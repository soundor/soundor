// Which executable launchHost() runs. Never builds and never downloads:
//
//   1. options.executable, or SOUNDOR_VST3_HOST_EXECUTABLE
//   2. the installed platform package (@soundor/vst3-host-<target>), checked
//      against this client's version and protocol
//   3. in a source checkout, the build or download prepareHost() selected,
//      if it still matches the native sources
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { Vst3HostError } from './errors.ts';
import { nativeInputs } from './inputs.ts';
import { PROTOCOL_VERSION } from './protocol.ts';
import {
  PROVENANCE_FILE,
  type Provenance,
  checkedProvenance,
  sha256File,
} from './provenance.ts';
import {
  currentPlatform,
  describePlatform,
  isSourceWorkspace,
  ownManifest,
  packageRoot,
  targetFor,
  versionAtLeast,
} from './targets.ts';

export interface ResolvedHost {
  executable: string;
  source: 'explicit' | 'package' | 'selection';
  /** Why this one, for logs. */
  reason: string;
  provenance?: Provenance;
}

export interface ResolveOptions {
  executable?: string;
  /** Default: this package's root. */
  root?: string;
}

/** The selection prepareHost() records in a source checkout. */
export interface Selection {
  mode: 'prebuilt' | 'source' | 'artifact';
  /** Relative to the package root. */
  executable: string;
  sha256: string;
  sourceFingerprint: string;
  version: string;
  target: string;
  reason: string;
}

export function selectionFile(root = packageRoot): string {
  return join(root, 'build', 'selected.json');
}

const verified = new Map<string, string>();
function verifyExecutable(path: string, sha256: string, what: string): void {
  if (verified.get(path) === sha256) return;
  if (!existsSync(path))
    throw new Vst3HostError(
      'executable-not-found',
      `${what}: ${path} does not exist`,
    );
  if (sha256File(path) !== sha256)
    throw new Vst3HostError(
      'incompatible-host',
      `${what}: ${path} is not the executable its record describes (SHA-256 differs)`,
    );
  verified.set(path, sha256);
}

export function resolveHost(options: ResolveOptions = {}): ResolvedHost {
  const root = options.root ?? packageRoot;
  const explicit =
    options.executable ?? process.env.SOUNDOR_VST3_HOST_EXECUTABLE;
  if (explicit) {
    const executable = resolve(explicit);
    if (!existsSync(executable))
      throw new Vst3HostError(
        'executable-not-found',
        `the VST3 host executable ${executable} does not exist`,
      );
    return {
      executable,
      source: 'explicit',
      reason: options.executable
        ? 'given as `executable`'
        : 'SOUNDOR_VST3_HOST_EXECUTABLE',
    };
  }

  const platform = currentPlatform();
  const target = targetFor(platform);
  if (!target)
    throw new Vst3HostError(
      'unsupported-platform',
      `@soundor/vst3-host has no executable for ${describePlatform(platform)}; it ships for Linux x64 (glibc), macOS (arm64 and x64) and Windows x64`,
    );
  const manifest = ownManifest(root);

  if (isSourceWorkspace(root)) {
    const file = selectionFile(root);
    if (!existsSync(file))
      throw new Vst3HostError(
        'executable-not-found',
        'no VST3 host executable is selected in this checkout: run `pnpm --filter @soundor/vst3-host build:native` (prepareHost()) first',
      );
    const selection = JSON.parse(readFileSync(file, 'utf8')) as Selection;
    const { fingerprint } = nativeInputs(root);
    if (
      selection.sourceFingerprint !== fingerprint ||
      selection.version !== manifest.version
    )
      throw new Vst3HostError(
        'executable-not-found',
        'the selected VST3 host executable was built from other native sources than this checkout has: run `pnpm --filter @soundor/vst3-host build:native` again',
        { selected: selection.sourceFingerprint, current: fingerprint },
      );
    const executable = isAbsolute(selection.executable)
      ? selection.executable
      : join(root, selection.executable);
    verifyExecutable(executable, selection.sha256, 'the selected VST3 host');
    return { executable, source: 'selection', reason: selection.reason };
  }

  let packageJson: string;
  try {
    packageJson = createRequire(join(root, 'package.json')).resolve(
      `${target.package}/package.json`,
    );
  } catch {
    throw new Vst3HostError(
      'platform-package-missing',
      `${target.package} is not installed. npm or pnpm installs it with @soundor/vst3-host as an optional dependency for ${describePlatform(platform)}; it is missing when optional dependencies are omitted (--no-optional, --omit=optional) or node_modules came from another platform. Reinstall with optional dependencies.`,
      { package: target.package, version: manifest.version },
    );
  }
  const directory = dirname(packageJson);
  const platformManifest = JSON.parse(readFileSync(packageJson, 'utf8')) as {
    version: string;
  };
  const provenance = checkedProvenance(
    JSON.parse(readFileSync(join(directory, PROVENANCE_FILE), 'utf8')),
    `${target.package}/${PROVENANCE_FILE}`,
  );
  if (
    platformManifest.version !== manifest.version ||
    provenance.version !== manifest.version
  )
    throw new Vst3HostError(
      'incompatible-host',
      `${target.package}@${platformManifest.version} is installed; @soundor/vst3-host@${manifest.version} needs exactly ${manifest.version}. Reinstall so both match.`,
    );
  if (
    provenance.protocol !== PROTOCOL_VERSION ||
    provenance.target !== target.target
  )
    throw new Vst3HostError(
      'incompatible-host',
      `${target.package} holds a ${provenance.target} executable for protocol ${provenance.protocol}; this client needs ${target.target} and protocol ${PROTOCOL_VERSION}`,
    );
  if (
    provenance.glibc &&
    platform.glibc &&
    !versionAtLeast(platform.glibc, provenance.glibc)
  )
    throw new Vst3HostError(
      'unsupported-platform',
      `the VST3 host needs glibc ${provenance.glibc} or newer; this system has ${platform.glibc}`,
    );
  const executable = join(directory, target.executable);
  verifyExecutable(executable, provenance.executable.sha256, target.package);
  return {
    executable,
    source: 'package',
    reason: `${target.package}@${platformManifest.version}`,
    provenance,
  };
}
