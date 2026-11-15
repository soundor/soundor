/**
 * `@soundor/engine`'s Node API: the engine's binaries for build tooling.
 *
 * ```ts
 * import { engine } from '@soundor/engine';
 *
 * const { files } = await engine({ target: 'web' });
 * files.wasm; // soundor-core.wasm, an absolute path
 * ```
 *
 * Modes:
 *
 *   prebuilt (default)  the engine version's published artifact, from the
 *                       cache or downloaded (and verified) into it. In the
 *                       engine's source checkout, only if its inputs match
 *                       these sources; otherwise a local build of them
 *                       (reused while they stay the same).
 *   published           the published artifact and nothing else: an error
 *                       when there is none, or the sources differ from it
 *   source              always a local build (a source checkout)
 *
 * A network, registry or integrity failure is an error: never taken for
 * "unpublished", never a reason to build instead. For the web target,
 * SOUNDOR_ENGINE_WASM names a module to use instead of all of this.
 *
 * @module
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { engineInputs, webInputs } from '../../scripts/engine-inputs.mjs';
import { cacheRoot, removeDirectory, withLock } from './cache.ts';
import { EngineError } from './errors.ts';
import {
  type Fetch,
  type LoadedManifest,
  type ManifestArtifact,
  loadManifest,
} from './manifest.ts';
import { buildNative, nativeLink } from './native.ts';
import { installArchive, metadataProblems, readMetadata } from './prebuilt.ts';
import {
  type EngineTarget,
  NATIVE_VARIANTS,
  type NativeTarget,
  type NativeVariant,
  WEB_VARIANT,
  hostTarget,
  isNativeTarget,
  isSourceCheckout,
} from './targets.ts';
import {
  PROTOCOL_VERSION,
  buildFromSource,
  checkModule,
  localBuild,
} from './web.ts';

export type { EngineErrorCode } from './errors.ts';
export type { EngineTarget, NativeTarget, NativeVariant } from './targets.ts';

/** Where an artifact comes from (module comment). */
export type EngineMode = 'prebuilt' | 'published' | 'source';

export interface WebEngineOptions {
  target: 'web';
  mode?: EngineMode;
}

export interface NativeEngineOptions {
  target: NativeTarget;
  mode?: EngineMode;
  /** Which archive: default `release` (`-static`: Windows's static C runtime). */
  variant?: NativeVariant;
}

export type EngineOptions = WebEngineOptions | NativeEngineOptions;

/** What every prepared artifact says about itself. */
interface PreparedArtifact {
  /** `prebuilt`: a published release's; `source`: built here; `override`: SOUNDOR_ENGINE_WASM. */
  readonly mode: 'prebuilt' | 'source' | 'override';
  /** Why this one, for logs. */
  readonly reason: string;
  /** The engine package version. */
  readonly version: string;
  /** The inputs it was built from (engine-inputs.mjs); undefined for an override. */
  readonly sourceFingerprint: string | undefined;
}

export interface WebEngineArtifact extends PreparedArtifact {
  readonly target: 'web';
  /** Absolute paths. */
  readonly files: {
    /** The WebAssembly core, `soundor-core.wasm`, for `@soundor/engine/web`. */
    readonly wasm: string;
  };
}

export interface NativeEngineArtifact extends PreparedArtifact {
  readonly target: NativeTarget;
  readonly mode: 'prebuilt' | 'source';
  readonly variant: NativeVariant;
  /** The extracted (or staged) engine, with its soundor-engine.json. */
  readonly directory: string;
  /** Absolute paths. */
  readonly includeDirs: string[];
  /** Absolute paths, in link order. */
  readonly libraries: string[];
  /** System libraries and frameworks, as linker arguments. */
  readonly linkFlags: string[];
  /** Hermes's bytecode compiler, of the same Hermes as the libraries. */
  readonly hermesc: string;
}

export type EngineArtifact = WebEngineArtifact | NativeEngineArtifact;

/** @internal What tests and first-party tooling replace. */
export interface EngineContext {
  /** The engine package (default: this one). */
  root?: string;
  /** Default: SOUNDOR_CACHE, else the user cache directory. */
  cache?: string;
  /** Default: process.env (SOUNDOR_ENGINE_WASM, SOUNDOR_ENGINE_MANIFEST, EMSDK). */
  env?: NodeJS.ProcessEnv;
  fetch?: Fetch;
  /** Progress: downloads and builds. Default: stderr. */
  log?: (message: string) => void;
  /** Replaces the WebAssembly build. */
  buildWeb?: () => Promise<{ wasm: string; fingerprint: string }>;
  /** Replaces the native build; returns its stage. */
  buildNative?: (variant: NativeVariant) => string;
}

/** This package's directory: above dist/ when built, node/src/ in a checkout. */
function packageRoot(): string {
  for (let directory = dirname(fileURLToPath(import.meta.url)); ;) {
    const manifest = join(directory, 'package.json');
    if (
      existsSync(manifest) &&
      (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name ===
        '@soundor/engine'
    )
      return directory;
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error('@soundor/engine cannot find its package.json');
    directory = parent;
  }
}

/** The engine's artifact for <target>, prepared (module comment). */
export function engine(
  options: WebEngineOptions,
  context?: EngineContext,
): Promise<WebEngineArtifact>;
export function engine(
  options: NativeEngineOptions,
  context?: EngineContext,
): Promise<NativeEngineArtifact>;
export function engine(
  options: EngineOptions,
  context?: EngineContext,
): Promise<EngineArtifact>;
export async function engine(
  options: EngineOptions,
  context: EngineContext = {},
): Promise<EngineArtifact> {
  const mode = options.mode ?? 'prebuilt';
  if (!['prebuilt', 'published', 'source'].includes(mode))
    throw new EngineError(
      'invalid-options',
      `engine() mode is prebuilt, published or source, not ${JSON.stringify(mode)}`,
    );
  if (options.target !== 'web' && !isNativeTarget(options.target))
    throw new EngineError(
      'invalid-options',
      `engine() target is web, linux-x64, windows-x64 or macos-universal, not ${JSON.stringify(options.target)}`,
    );
  const env = context.env ?? process.env;
  const root = context.root ?? packageRoot();
  const write = context.log ?? ((message: string) => console.error(message));
  const run: Run = {
    mode,
    root,
    env,
    checkout: isSourceCheckout(root),
    version: (
      JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
        version: string;
      }
    ).version,
    cache: context.cache ?? cacheRoot(env),
    fetch: context.fetch ?? fetch,
    log: (message) => write(`Soundor engine: ${message}`),
    context,
  };
  if (options.target === 'web') return web(run);
  const variant = (options as NativeEngineOptions).variant ?? 'release';
  if (!NATIVE_VARIANTS.includes(variant))
    throw new EngineError(
      'invalid-options',
      `engine() variant is ${NATIVE_VARIANTS.join(', ')}, not ${JSON.stringify(variant)}`,
    );
  if (variant.endsWith('-static') && options.target !== 'windows-x64')
    throw new EngineError(
      'invalid-options',
      `The ${variant} engine is Windows's (the static C runtime); ${options.target} has debug and release`,
    );
  return native(run, options.target, variant);
}

interface Run {
  mode: EngineMode;
  root: string;
  env: NodeJS.ProcessEnv;
  checkout: boolean;
  version: string;
  cache: string;
  fetch: Fetch;
  log: (message: string) => void;
  context: EngineContext;
}

type Published =
  | {
      found: true;
      directory: string;
      artifact: ManifestArtifact;
      manifest: LoadedManifest;
    }
  | { found: false; reason: string };

/**
 * The published artifact for <target>/<variant>, installed in the cache, if
 * the release has one that matches <fingerprint> (a checkout's inputs).
 */
async function published(
  run: Run,
  target: EngineTarget,
  variant: string,
  fingerprint: string | undefined,
): Promise<Published> {
  const manifest = await loadManifest({
    root: run.root,
    version: run.version,
    cache: run.cache,
    fetch: run.fetch,
    explicit: run.env['SOUNDOR_ENGINE_MANIFEST'] || undefined,
  });
  const name = `@soundor/engine ${run.version}`;
  if (manifest === null)
    return { found: false, reason: `${name} is not published` };
  const artifact = manifest.value.artifacts.find(
    (entry) => entry.target === target && entry.variant === variant,
  );
  const fail = (reason: string): Published => {
    if (manifest.explicit)
      throw new EngineError(
        'unavailable',
        `The engine manifest ${manifest.path}: ${reason}`,
      );
    return { found: false, reason };
  };
  if (!artifact)
    return fail(
      `the prebuilt release of ${name} (${manifest.value.tag}) has no ${target === 'web' ? '' : `${variant} `}${target} artifact`,
    );
  const released =
    target === 'web'
      ? artifact.sourceFingerprint
      : manifest.value.sourceFingerprint;
  if (fingerprint !== undefined && released !== fingerprint)
    return fail(
      `the engine's ${target === 'web' ? 'WebAssembly' : 'native'} sources differ from ${manifest.value.tag}'s`,
    );
  // Another protocol cannot work with this package's JavaScript: a broken
  // release, never a reason to build instead.
  if (target === 'web' && artifact.protocol !== PROTOCOL_VERSION)
    throw new EngineError(
      'artifact',
      `${artifact.file} of ${manifest.value.tag} speaks protocol ${artifact.protocol}; this @soundor/engine speaks ${PROTOCOL_VERSION}`,
    );
  let directory = await installArchive(artifact, run);
  let problems = metadataProblems(
    readMetadata(directory),
    manifest.value,
    artifact,
    directory,
  );
  if (problems.length) {
    // A damaged cache entry: extracted again from the verified archive.
    run.log(
      `the cached ${artifact.file} is damaged (${problems.join('; ')}); extracting it again`,
    );
    removeDirectory(join(run.cache, 'engine-prebuilts', artifact.sha256));
    directory = await installArchive(artifact, run);
    problems = metadataProblems(
      readMetadata(directory),
      manifest.value,
      artifact,
      directory,
    );
    if (problems.length)
      throw new EngineError(
        'artifact',
        `${artifact.file} of ${manifest.value.tag} is not the artifact its manifest names: ${problems.join('; ')}`,
      );
  }
  return { found: true, directory, artifact, manifest };
}

function unavailable(reason: string, hint: string): never {
  throw new EngineError(
    'unavailable',
    `No engine artifact to use: ${reason}. ${hint}`,
  );
}

async function web(run: Run): Promise<WebEngineArtifact> {
  const base = { target: 'web' as const, version: run.version };
  const given = run.env['SOUNDOR_ENGINE_WASM'];
  if (given) {
    checkModule(given, 'SOUNDOR_ENGINE_WASM');
    return {
      ...base,
      mode: 'override',
      reason: 'SOUNDOR_ENGINE_WASM',
      sourceFingerprint: undefined,
      files: { wasm: given },
    };
  }
  const build = async (reason: string): Promise<WebEngineArtifact> => {
    if (!run.checkout)
      unavailable(
        reason,
        'An installed @soundor/engine cannot build its WebAssembly: install a published version.',
      );
    const built = await (run.context.buildWeb?.() ??
      buildFromSource(run.root, { env: run.env, log: run.log }));
    return {
      ...base,
      mode: 'source',
      reason,
      sourceFingerprint: built.fingerprint,
      files: { wasm: built.wasm },
    };
  };
  if (run.mode === 'source') return build('built from source as requested');

  const fingerprint = run.checkout
    ? webInputs(run.root).fingerprint
    : undefined;
  // A local build of exactly these sources is what the release would be
  // (unless a manifest is given: then its artifact is what is tested).
  if (
    run.mode === 'prebuilt' &&
    fingerprint !== undefined &&
    !run.env['SOUNDOR_ENGINE_MANIFEST']
  ) {
    const local = localBuild(run.root, fingerprint);
    if (local)
      return {
        ...base,
        mode: 'source',
        reason: 'the local build of these sources (build/wasm/stage)',
        sourceFingerprint: fingerprint,
        files: local,
      };
  }
  const found = await published(run, 'web', WEB_VARIANT, fingerprint);
  if (found.found) {
    const wasm = join(
      found.directory,
      readMetadata(found.directory).files!.wasm!.path,
    );
    checkModule(wasm, found.artifact.file);
    return {
      ...base,
      mode: 'prebuilt',
      reason: `${found.artifact.file} of ${found.manifest.value.tag}`,
      sourceFingerprint: found.artifact.sourceFingerprint,
      files: { wasm },
    };
  }
  if (run.mode === 'published')
    unavailable(found.reason, 'Mode "published" uses nothing else.');
  run.log(`building the WebAssembly core from source (${found.reason})`);
  return build(`${found.reason}; built from source`);
}

async function native(
  run: Run,
  target: NativeTarget,
  variant: NativeVariant,
): Promise<NativeEngineArtifact> {
  const base = { target, variant, version: run.version };
  const build = async (reason: string): Promise<NativeEngineArtifact> => {
    if (!run.checkout)
      unavailable(
        reason,
        'An installed @soundor/engine builds its native engine through its CMake (SOUNDOR_ENGINE_MODE=source), not engine().',
      );
    if (hostTarget() !== target)
      unavailable(
        reason,
        `Only the ${hostTarget() ?? 'no'} native engine can be built here.`,
      );
    const stage = await withLock(
      join(run.root, 'build', `prebuilt-${variant}.lock`),
      () =>
        run.context.buildNative
          ? run.context.buildNative(variant)
          : buildNative(run.root, variant, { env: run.env, log: run.log }),
    );
    const metadata = readMetadata(stage);
    return {
      ...base,
      mode: 'source',
      reason,
      sourceFingerprint: metadata.engine.sourceFingerprint,
      ...nativeLink(stage, target),
    };
  };
  if (run.mode === 'source') return build('built from source as requested');
  const fingerprint = run.checkout
    ? engineInputs(run.root).fingerprint
    : undefined;
  const found = await published(run, target, variant, fingerprint);
  if (found.found)
    return {
      ...base,
      mode: 'prebuilt',
      reason: `${found.artifact.file} of ${found.manifest.value.tag}`,
      sourceFingerprint: found.manifest.value.sourceFingerprint,
      ...nativeLink(found.directory, target),
    };
  if (run.mode === 'published')
    unavailable(found.reason, 'Mode "published" uses nothing else.');
  run.log(`building the native engine from source (${found.reason})`);
  return build(`${found.reason}; built from source`);
}
