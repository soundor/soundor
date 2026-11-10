/**
 * Runtime compatibility: whether a runtime implements a runtime API version
 * the host supports, and has what the project's config uses. The one
 * implementation every entry point uses, through `resolveRuntime`.
 */

import { RuntimeCompatibilityError } from '@soundor/core';

import type { Runtime } from './runtime';
import type { SoundorConfig } from './types';
import {
  CONFIG_VERSION,
  MIN_RUNTIME_API_VERSION,
  RUNTIME_API_VERSION,
} from './version';

/** What a runtime implements that predates `apiVersion`. */
const FIRST_API_VERSION = 1;

/**
 * A config setting added to the runtime API after its first version. A
 * runtime of an older version does not know it, so a project that uses it is
 * refused rather than having it ignored.
 */
export interface ConfigFeature {
  /** The runtime API version that added it. */
  readonly since: number;
  /** What it is, for the error: `parameter mappings`. */
  readonly name: string;
  /** The paths in `config` that use it: `parameters[0].mapping`. */
  find(config: SoundorConfig): string[];
}

/**
 * Every config setting added after the first runtime API version, with the
 * version that added it. Add one with each config field a raise of
 * {@link RUNTIME_API_VERSION} brings.
 */
export const CONFIG_FEATURES: readonly ConfigFeature[] = [];

/** The runtime API versions a host runs runtimes of. */
export interface HostRuntimeApi {
  readonly min: number;
  readonly current: number;
  /** The host's `@soundor/config`, for messages. */
  readonly configVersion: string;
}

/** This copy's. */
export const HOST_RUNTIME_API: HostRuntimeApi = {
  min: MIN_RUNTIME_API_VERSION,
  current: RUNTIME_API_VERSION,
  configVersion: CONFIG_VERSION,
};

/**
 * The runtime API version `runtime` implements: its `apiVersion`, or the
 * first one for a runtime made before it existed. Throws {@link
 * RuntimeCompatibilityError} (`INVALID_RUNTIME`) for one that is not a
 * positive integer.
 */
export function runtimeApiVersion(runtime: Runtime): number {
  const declared: unknown = runtime.apiVersion;
  if (declared === undefined) return FIRST_API_VERSION;
  if (
    typeof declared === 'number' &&
    Number.isInteger(declared) &&
    declared > 0
  )
    return declared;
  throw new RuntimeCompatibilityError(
    `Runtime '${runtime.id}' has an unreadable runtime API version: ${JSON.stringify(declared)}.`,
    {
      runtimeId: runtime.id,
      code: 'INVALID_RUNTIME',
      hint: 'A runtime made with defineRuntime() from @soundor/runtime-sdk has a positive integer; report it to its authors.',
    },
  );
}

/**
 * Checks that the host runs runtimes of `runtime`'s API version, and that
 * `config` uses nothing newer than it. Returns that version; throws {@link
 * RuntimeCompatibilityError} (`INCOMPATIBLE_RUNTIME`) otherwise.
 */
export function checkRuntimeCompatibility(
  runtime: Runtime,
  config: SoundorConfig,
  {
    host = HOST_RUNTIME_API,
    features = CONFIG_FEATURES,
  }: {
    host?: HostRuntimeApi;
    features?: readonly ConfigFeature[];
  } = {},
): number {
  const version = runtimeApiVersion(runtime);
  const supported =
    host.min === host.current
      ? `runtime API ${host.current}`
      : `runtime API ${host.min} to ${host.current}`;
  if (version > host.current) {
    throw new RuntimeCompatibilityError(
      `Runtime '${runtime.id}' implements runtime API ${version}, newer than this soundor (@soundor/config ${host.configVersion}), which runs ${supported}.`,
      {
        runtimeId: runtime.id,
        hint: 'Upgrade soundor and @soundor/config to a release the runtime is made for, or use an older release of the runtime.',
      },
    );
  }
  if (version < host.min) {
    throw new RuntimeCompatibilityError(
      `Runtime '${runtime.id}' implements runtime API ${version}, which this soundor (@soundor/config ${host.configVersion}) no longer runs: it runs ${supported}.`,
      {
        runtimeId: runtime.id,
        hint: `Upgrade the runtime to a release made for runtime API ${host.current}, or use an older soundor and @soundor/config.`,
      },
    );
  }
  const issues = features
    .filter((feature) => feature.since > version)
    .flatMap((feature) =>
      feature.find(config).map((path) => ({
        path,
        message: `${feature.name}, from runtime API ${feature.since}`,
      })),
    );
  if (issues.length > 0) {
    throw new RuntimeCompatibilityError(
      `Runtime '${runtime.id}' implements runtime API ${version}, which does not have what this config uses:`,
      {
        runtimeId: runtime.id,
        issues,
        hint: 'Upgrade the runtime to a release that supports them, or remove them from the config.',
      },
    );
  }
  return version;
}
