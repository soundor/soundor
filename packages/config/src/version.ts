import { version } from '../package.json';

/**
 * This copy's version of `@soundor/config`, inlined when it is built: the
 * version of the package that parses a project's config and drives its
 * runtimes. A runtime's declared `config` range is checked against it.
 */
export const CONFIG_VERSION: string = version;

/**
 * The version of the config schema this copy validates, normalizes and hands
 * to runtimes. It changes whenever a config may mean something a runtime
 * written for the previous one would not handle: a new field, type or value
 * (not a stricter check or a better message). A runtime lists the schema
 * versions it implements in full (`compatibility.schemas`), so a field it
 * does not know is rejected instead of ignored.
 */
export const CONFIG_SCHEMA_VERSION = 1;
