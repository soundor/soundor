import { version } from '../package.json';

/**
 * This copy's version of `@soundor/config`, inlined when it is built: the
 * version of the package that parses a project's config and drives its
 * runtimes.
 */
export const CONFIG_VERSION: string = version;

/**
 * The version of the runtime API: everything a runtime depends on of its host,
 * the {@link Runtime} interface, the `LifecycleContext` and what it carries,
 * the config a runtime receives, and the error protocol. Independent of the
 * package versions, which change for much that runtimes never see.
 *
 * Never edit these numbers by hand. `packages/config/runtime-api.json` owns
 * them: it records, per release line, the version the last published line
 * shipped (`released`), the oldest version it runs (`min`), and a pending
 * contract change (`next`: `"raise"` for a compatible addition, `"break"`
 * when older runtimes cannot run). This file is written from the record by
 * `UPDATE_RUNTIME_API=1 pnpm --filter @soundor/config test`, and the release
 * resolver (`scripts/resolve-release.mjs`) advances the record when the
 * pending change ships — so published versions are dense, one per
 * contract-bearing release, whatever number of PRs made them.
 *
 * It changes, only in a minor release before 1.0 (so every copy of one release
 * line agrees), whenever a runtime could be affected:
 *
 * - a compatible addition (a context field, an optional config field) raises
 *   it, and keeps {@link MIN_RUNTIME_API_VERSION}: runtimes for older versions
 *   still run, and a config field it adds is tagged in `CONFIG_FEATURES` so a
 *   project that uses it is refused with one of them;
 * - a break raises both: runtimes for older versions are refused.
 *
 * `runtime-api.json` records the contract the pending release ships; a test
 * fails when the contract changes without a pending change recorded.
 */
export const RUNTIME_API_VERSION = 2;

/** The oldest runtime API version this host still runs runtimes of. */
export const MIN_RUNTIME_API_VERSION = 2;

/**
 * The runtime API version the pending release ships: the `since` of a
 * `CONFIG_FEATURES` entry added now, until the release resolver materializes
 * it to the shipped number. Write a new config feature's `since` as this, and
 * let the resolver write the number.
 */
export const NEXT_API_VERSION = RUNTIME_API_VERSION;
