/**
 * The prebuilt VST3 adapter a plugin links (`libsoundor_vst3.a`;
 * `soundor_vst3.lib` on Windows), one per target and variant:
 *
 * - An installed package carries `artifacts/manifest.json`, which names the
 *   adapters of its GitHub release (`vst3-adapters-v<version>-<sha>-r<n>`,
 *   `.github/scripts/vst3-adapters.mjs`): the one a build needs is
 *   downloaded once into the Soundor cache (`<cache>/vst3-adapters/`),
 *   checked against its SHA-256 and size, and extracted, as the engine's
 *   archives are (`@soundor/engine/archives`).
 * - Soundor's workspace builds its own into `prebuilt/<target>-<variant>/`
 *   (`pnpm --filter @soundor/vst3-runtime build:native`).
 * - `SOUNDOR_VST3_ADAPTER_MANIFEST` names a manifest to use instead of
 *   either (CI's archives, before they are released).
 * - Source mode ({@link sourceAdapter}) builds one from `native/` against
 *   the engine the plugin links, into `<cache>/vst3-adapter-source/`.
 *
 * Every adapter is checked against the engine the plugin links: one compiled
 * against other engine headers would misread its classes. A download or
 * integrity failure is an error, never a reason to look elsewhere.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  cacheRoot,
  type Fetch,
  installArchive,
  withLock,
} from '@soundor/engine/archives';
import { EnvError } from '@soundor/runtime-sdk';

import { type AdapterEngine, buildAdapter } from './source';
import { adapterArchiveName, type Variant, type Vst3Target } from './targets';

/** What `adapter.json` says of a prebuilt adapter. */
export interface AdapterMetadata {
  readonly format: number;
  readonly runtimeVersion: string;
  readonly target: string;
  readonly variant: Variant;
  readonly vst3sdk?: string;
  readonly engine: {
    readonly version: string;
    readonly sourceFingerprint?: string;
    readonly abiNamespace?: string;
  };
}

/** An adapter archive of the release, as the manifest names it. */
export interface AdapterManifestArtifact {
  readonly file: string;
  readonly target: Vst3Target;
  readonly variant: Variant;
  readonly sha256: string;
  readonly size: number;
  readonly url: string;
}

/** `artifacts/manifest.json`: the release the package's adapters are in. */
export interface AdapterManifest {
  readonly format: 1;
  readonly runtimeVersion: string;
  readonly sourceCommit: string;
  readonly revision: number;
  readonly tag: string;
  readonly release: string | null;
  readonly engine: {
    readonly version: string;
    readonly sourceFingerprint: string;
  };
  readonly artifacts: readonly AdapterManifestArtifact[];
}

/** The engine a plugin links, as engine() describes it. */
export interface LinkedEngine {
  readonly version: string;
  readonly sourceFingerprint: string | undefined;
}

export interface ResolvedAdapter {
  /** The archive to link. */
  readonly archive: string;
  /** Its directory, with adapter.json and licenses/. */
  readonly directory: string;
  /** Where it came from, for logs. */
  readonly reason: string;
}

/** What tests replace. */
export interface AdapterContext {
  /** Default: process.env (SOUNDOR_VST3_ADAPTER_MANIFEST, SOUNDOR_CACHE). */
  readonly env?: NodeJS.ProcessEnv;
  /** Default: SOUNDOR_CACHE, else the user cache directory. */
  readonly cache?: string;
  readonly fetch?: Fetch;
  /** Progress: downloads. */
  readonly log?: (message: string) => void;
}

const BUILD_HINT =
  "In Soundor's workspace, build it with `pnpm --filter @soundor/vst3-runtime build:native`.";

/** A workspace's own adapter: `prebuilt/<target>-<variant>`. */
export function adapterDirectory(
  packageRoot: string,
  target: Vst3Target,
  variant: Variant,
): string {
  return join(packageRoot, 'prebuilt', `${target}-${variant}`);
}

/** The runtime's source checkout (the adapter's tests are never published). */
export function isSourceCheckout(packageRoot: string): boolean {
  return existsSync(join(packageRoot, 'native', 'tests', 'CMakeLists.txt'));
}

export function packageVersion(packageRoot: string): string {
  return (
    JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      version: string;
    }
  ).version;
}

const sha256Pattern = /^[0-9a-f]{64}$/;

/** Checks what every use of a manifest relies on. */
export function checkedManifest(
  value: unknown,
  version: string,
  where: string,
): AdapterManifest {
  const manifest = value as Partial<AdapterManifest> | null;
  const problems: string[] = [];
  if (manifest?.format !== 1) problems.push('its format is not 1');
  if (manifest?.runtimeVersion !== version)
    problems.push(`it is runtime ${manifest?.runtimeVersion}, not ${version}`);
  if (
    typeof manifest?.engine?.version !== 'string' ||
    !sha256Pattern.test(manifest.engine.sourceFingerprint ?? '')
  )
    problems.push('it names no engine version and input fingerprint');
  if (!Array.isArray(manifest?.artifacts))
    problems.push('it lists no artifacts');
  for (const artifact of manifest?.artifacts ?? [])
    if (
      typeof artifact?.file !== 'string' ||
      typeof artifact.target !== 'string' ||
      typeof artifact.variant !== 'string' ||
      typeof artifact.url !== 'string' ||
      !sha256Pattern.test(artifact.sha256 ?? '') ||
      !Number.isSafeInteger(artifact.size) ||
      artifact.size <= 0
    )
      problems.push(
        `${artifact?.file ?? '(unnamed)'} lacks its file, target, variant, URL, SHA-256 or size`,
      );
  if (problems.length)
    throw new EnvError(
      `${where} is not an adapter manifest of @soundor/vst3-runtime ${version}: ${problems.join('; ')}`,
    );
  return manifest as AdapterManifest;
}

function engineMismatch(
  built: AdapterMetadata['engine'],
  engine: LinkedEngine,
): boolean {
  return (
    built.version !== engine.version ||
    (built.sourceFingerprint !== undefined &&
      engine.sourceFingerprint !== undefined &&
      built.sourceFingerprint !== engine.sourceFingerprint)
  );
}

function describeEngine(engine: {
  readonly version: string;
  readonly sourceFingerprint?: string | undefined;
}): string {
  return `${engine.version}, ${engine.sourceFingerprint ?? 'unknown inputs'}`;
}

/**
 * The adapter in <directory>, checked: its metadata names <target>,
 * <variant> and the engine the plugin links. Returns the archive.
 */
export function checkAdapter(
  directory: string,
  target: Vst3Target,
  variant: Variant,
  engine: LinkedEngine,
  hint: string,
): string {
  const archive = join(directory, 'lib', adapterArchiveName(target));
  const metadataFile = join(directory, 'adapter.json');
  if (!existsSync(archive) || !existsSync(metadataFile))
    throw new EnvError(
      `The VST3 runtime's prebuilt ${variant} adapter is missing (${archive}). ${hint}`,
    );
  const metadata = JSON.parse(
    readFileSync(metadataFile, 'utf8'),
  ) as AdapterMetadata;
  if (
    metadata.format !== 1 ||
    metadata.target !== target ||
    metadata.variant !== variant
  )
    throw new EnvError(
      `${metadataFile} is not a ${target} ${variant} adapter this runtime reads.`,
    );
  if (engineMismatch(metadata.engine, engine))
    throw new EnvError(
      `The VST3 runtime's ${variant} adapter was built against another engine (${describeEngine(metadata.engine)}) than the one this plugin links (${describeEngine(engine)}). ${hint}`,
    );
  return archive;
}

/** The manifest a build uses, or undefined in a workspace without one given. */
export function adapterManifest(
  packageRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): { path: string; value: AdapterManifest; explicit: boolean } | undefined {
  const explicit = env['SOUNDOR_VST3_ADAPTER_MANIFEST'] || undefined;
  if (explicit === undefined && isSourceCheckout(packageRoot)) return undefined;
  const version = packageVersion(packageRoot);
  const path = explicit ?? join(packageRoot, 'artifacts', 'manifest.json');
  if (!existsSync(path))
    throw new EnvError(
      explicit
        ? `SOUNDOR_VST3_ADAPTER_MANIFEST names ${path}, which does not exist.`
        : `@soundor/vst3-runtime ${version} has no adapter manifest (${path}): only a published package carries one. Install a published version.`,
    );
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new EnvError(
      `Could not read the adapter manifest ${path}: ${(error as Error).message}`,
      { cause: error },
    );
  }
  return {
    path,
    value: checkedManifest(value, version, path),
    explicit: explicit !== undefined,
  };
}

/** The prebuilt adapter for <target> and <variant> (module comment). */
export async function resolveAdapter(
  packageRoot: string,
  target: Vst3Target,
  variant: Variant,
  engine: LinkedEngine,
  context: AdapterContext = {},
): Promise<ResolvedAdapter> {
  const env = context.env ?? process.env;
  const manifest = adapterManifest(packageRoot, env);
  if (manifest === undefined) {
    const directory = adapterDirectory(packageRoot, target, variant);
    return {
      archive: checkAdapter(directory, target, variant, engine, BUILD_HINT),
      directory,
      reason: 'built in this workspace (prebuilt/)',
    };
  }
  const { value, path } = manifest;
  const artifact = value.artifacts.find(
    (entry) => entry.target === target && entry.variant === variant,
  );
  if (artifact === undefined)
    throw new EnvError(
      `The adapter release ${value.tag} (${path}) has no ${variant} adapter for ${target}.`,
    );
  if (engineMismatch(value.engine, engine))
    throw new EnvError(
      `The adapters of ${value.tag} were built against engine ${describeEngine(value.engine)}; this plugin links ${describeEngine(engine)}. @soundor/vst3-runtime ${value.runtimeVersion} works with the @soundor/engine it depends on: reinstall it, so that the package manager installs that one.`,
    );
  let directory: string;
  try {
    directory = await installArchive(artifact, {
      cache: context.cache ?? cacheRoot(env),
      fetch: context.fetch ?? fetch,
      log: (message) =>
        (context.log ?? ((line: string) => console.error(line)))(
          `VST3 adapter: ${message}`,
        ),
      directory: 'vst3-adapters',
    });
  } catch (error) {
    throw new EnvError(
      `Could not prepare the ${variant} adapter ${artifact.file} of ${value.tag}: ${(error as Error).message}`,
      { cause: error },
    );
  }
  const hint = `Delete ${directory} to download it again.`;
  const archive = checkAdapter(directory, target, variant, engine, hint);
  const metadata = JSON.parse(
    readFileSync(join(directory, 'adapter.json'), 'utf8'),
  ) as AdapterMetadata;
  if (metadata.runtimeVersion !== value.runtimeVersion)
    throw new EnvError(
      `${artifact.file} of ${value.tag} is the adapter of runtime ${metadata.runtimeVersion}, not ${value.runtimeVersion}. ${hint}`,
    );
  return { archive, directory, reason: `${artifact.file} of ${value.tag}` };
}

/** What a source build replaces in tests. */
export interface SourceContext extends AdapterContext {
  /** Replaces the CMake build: stages the adapter into <stage>. */
  readonly build?: (build: string, stage: string) => void;
}

/**
 * Source mode: the adapter built from `native/` against <engine> (the
 * engine the plugin links, as engine() prepared it), with CMake, into
 * `<cache>/vst3-adapter-source/<version>/<target>-<variant>-<engine inputs>/`.
 * An installed package's stage is reused (its sources never change); the
 * workspace's is built again, incrementally, every time.
 */
export async function sourceAdapter(
  packageRoot: string,
  target: Vst3Target,
  variant: Variant,
  engine: AdapterEngine,
  context: SourceContext = {},
): Promise<ResolvedAdapter> {
  const env = context.env ?? process.env;
  const version = packageVersion(packageRoot);
  const inputs = (engine.sourceFingerprint ?? engine.version).slice(0, 16);
  const directory = join(
    context.cache ?? cacheRoot(env),
    'vst3-adapter-source',
    version,
    `${target}-${variant}-${inputs}`,
  );
  const stage = join(directory, 'stage');
  const checkout = isSourceCheckout(packageRoot);
  const log = context.log ?? ((line: string) => console.error(line));
  await withLock(
    `${directory}.lock`,
    () => {
      if (!checkout && existsSync(join(stage, 'adapter.json'))) return;
      log(
        `VST3 adapter: building the ${variant} adapter from source (CMake) into ${directory}`,
      );
      try {
        (
          context.build ??
          ((build: string, into: string) =>
            buildAdapter(
              { packageRoot, target, variant, engine, build, env },
              into,
            ))
        )(join(directory, 'build'), stage);
      } catch (error) {
        throw new EnvError(
          `Building the VST3 adapter from source failed: ${(error as Error).message}`,
          { cause: error },
        );
      }
    },
    {
      waiting: () =>
        log(
          `VST3 adapter: waiting for another process to build the ${variant} adapter`,
        ),
    },
  );
  return {
    archive: checkAdapter(
      stage,
      target,
      variant,
      engine,
      `Delete ${directory} to build it again.`,
    ),
    directory: stage,
    reason: `built from source (${directory})`,
  };
}
