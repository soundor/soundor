// The prebuilt release this engine version names: artifacts/manifest.json,
// written into the npm package by the release workflow from the verified
// public release (never committed). A source checkout reads the exact
// published npm version's copy (engine-selection.mjs, as CMake does), or an
// explicitly given one (SOUNDOR_ENGINE_MANIFEST: CI's archives).

import { readFileSync } from 'node:fs';

import { releasedManifest } from '../../scripts/engine-selection.mjs';
import { EngineError } from './errors.ts';
import type { EngineTarget } from './targets.ts';

const sha256Pattern = /^[0-9a-f]{64}$/;

export interface ManifestArtifact {
  readonly file: string;
  readonly target: EngineTarget;
  readonly variant: string;
  readonly sha256: string;
  readonly size: number;
  readonly url: string;
  /** The web archive's own input fingerprint (engine-inputs.mjs's webInputs). */
  readonly sourceFingerprint?: string;
  /** The web module's protocol (wasm/Engine.h's protocolVersion). */
  readonly protocol?: number;
}

export interface Manifest {
  readonly format: 1;
  readonly engineVersion: string;
  readonly abiNamespace: string;
  readonly sourceCommit: string;
  /** The native archives' input fingerprint (engine-inputs.mjs's engineInputs). */
  readonly sourceFingerprint?: string;
  readonly revision: number;
  readonly tag: string;
  readonly artifacts: readonly ManifestArtifact[];
}

export interface LoadedManifest {
  readonly path: string;
  readonly value: Manifest;
  /** Given explicitly: it must match, never be built around. */
  readonly explicit: boolean;
}

export type Fetch = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<Response>;

/** Checks what every use of a manifest relies on. */
export function checkedManifest(
  value: unknown,
  version: string,
  where: string,
): Manifest {
  const manifest = value as Partial<Manifest> | null;
  const problems: string[] = [];
  if (manifest?.format !== 1) problems.push('its format is not 1');
  if (manifest?.engineVersion !== version)
    problems.push(`it is engine ${manifest?.engineVersion}, not ${version}`);
  if (!/^[0-9a-f]{40}$/.test(manifest?.sourceCommit ?? ''))
    problems.push('it names no source commit');
  if (
    manifest?.sourceFingerprint !== undefined &&
    !sha256Pattern.test(manifest.sourceFingerprint)
  )
    problems.push('its source fingerprint is invalid');
  if (!Array.isArray(manifest?.artifacts))
    problems.push('it lists no artifacts');
  for (const artifact of manifest?.artifacts ?? []) {
    const name = (artifact as Partial<ManifestArtifact>)?.file ?? '(unnamed)';
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
        `${name} lacks its file, target, variant, URL, SHA-256 or size`,
      );
    else if (
      artifact.target === 'web' &&
      (!sha256Pattern.test(artifact.sourceFingerprint ?? '') ||
        !Number.isSafeInteger(artifact.protocol))
    )
      problems.push(`${name} lacks its source fingerprint or protocol`);
  }
  if (problems.length)
    throw new EngineError(
      'manifest',
      `${where} is not a prebuilt manifest of @soundor/engine ${version}: ${problems.join('; ')}`,
    );
  return manifest as Manifest;
}

/**
 * The manifest, or null when this version has none (it is not published,
 * or was published without one). A network, registry or integrity failure is
 * an error, never "unpublished".
 */
export async function loadManifest(context: {
  root: string;
  version: string;
  cache: string;
  fetch: Fetch;
  explicit?: string;
}): Promise<LoadedManifest | null> {
  if (context.explicit) {
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(context.explicit, 'utf8'));
    } catch (error) {
      throw new EngineError(
        'manifest',
        `Could not read the engine manifest ${context.explicit} (SOUNDOR_ENGINE_MANIFEST): ${(error as Error).message}`,
        { cause: error },
      );
    }
    return {
      path: context.explicit,
      value: checkedManifest(value, context.version, context.explicit),
      explicit: true,
    };
  }
  let released: { path: string; value: unknown } | null;
  try {
    // Called with a URL string only.
    released = await releasedManifest(
      context.root,
      context.cache,
      context.fetch as typeof fetch,
    );
  } catch (error) {
    throw new EngineError(
      'manifest',
      `Could not read the prebuilt manifest of @soundor/engine ${context.version} (${(error as Error).message}). ` +
        'It is fetched once from the npm registry, then cached. ' +
        'Offline in the engine checkout, `pnpm --filter @soundor/engine build:wasm` builds the module instead.',
      { cause: error },
    );
  }
  if (released === null) return null;
  return {
    path: released.path,
    value: checkedManifest(released.value, context.version, released.path),
    explicit: false,
  };
}
