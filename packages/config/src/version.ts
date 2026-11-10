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
 * It changes, only in a minor release before 1.0 (so every copy of one release
 * line agrees), whenever a runtime could be affected:
 *
 * - a compatible addition (a context field, an optional config field) raises
 *   it, and keeps {@link MIN_RUNTIME_API_VERSION}: runtimes for older versions
 *   still run, and a config field it adds is tagged in `CONFIG_FEATURES` so a
 *   project that uses it is refused with one of them;
 * - a break raises both: runtimes for older versions are refused.
 *
 * `runtime-api.json` records the contract it describes; a test fails when the
 * contract changes without it.
 */
export const RUNTIME_API_VERSION = 1;

/** The oldest runtime API version this host still runs runtimes of. */
export const MIN_RUNTIME_API_VERSION = 1;
