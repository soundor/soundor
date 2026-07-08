import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { type Plugin, rolldown } from 'rolldown';

import { ConfigError } from './errors';

export const CONFIG_FILENAME = 'soundor.config.ts';

const CONFIG_MODULE = '@soundor/config';
const SHIM_ID = '\0soundor:config';

/**
 * Replaces the `@soundor/config` import with a minimal inline shim of
 * `defineSoundorConfig` (a pure identity helper). This keeps the bundle small
 * and self-contained — evaluating a config never pulls the loader or its
 * dependencies back in.
 */
const configShimPlugin: Plugin = {
  name: 'soundor:config-shim',
  resolveId(id) {
    return id === CONFIG_MODULE ? SHIM_ID : null;
  },
  load(id) {
    return id === SHIM_ID
      ? 'export const defineSoundorConfig = (config) => config;'
      : null;
  },
};

/**
 * Finds `soundor.config.ts` by walking up from `cwd` to the filesystem root.
 * Returns the absolute path, or throws {@link ConfigError} of kind `not-found`.
 */
export function locateConfig(cwd: string): string {
  let dir = resolve(cwd);
  for (;;) {
    const candidate = resolve(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new ConfigError(
    'not-found',
    `Could not find ${CONFIG_FILENAME} in ${resolve(cwd)} or any parent directory.`,
  );
}

/**
 * Bundles the config module in-memory with rolldown (no files written) and
 * returns its default export. Throws {@link ConfigError} of kind `load` if the
 * module cannot be evaluated or has no usable default export.
 */
export async function loadConfigModule(path: string): Promise<unknown> {
  const absolute = isAbsolute(path) ? path : resolve(path);
  if (!existsSync(absolute)) {
    throw new ConfigError(
      'not-found',
      `Config file does not exist: ${absolute}`,
    );
  }

  let code: string;
  try {
    const bundle = await rolldown({
      input: absolute,
      plugins: [configShimPlugin],
      // Keep bare specifiers external so imports the config relies on — notably
      // the runtime package in `runtimes: [juceRuntime(...)]` — are resolved by
      // Node from the project's node_modules when the bundle is evaluated,
      // rather than pulled into the bundle (where they'd hit the config shim).
      // `@soundor/config` itself is handled by the shim plugin above.
      external: (id) =>
        id !== CONFIG_MODULE &&
        !id.startsWith('.') &&
        !id.startsWith('\0') &&
        !isAbsolute(id),
      logLevel: 'silent',
    });
    const { output } = await bundle.generate({ format: 'esm' });
    await bundle.close();
    code = output[0].code;
  } catch (cause) {
    throw new ConfigError(
      'load',
      `Failed to bundle ${absolute}: ${errorMessage(cause)}`,
    );
  }

  // Evaluate from a temp file *next to the config* (not a data: URL) so Node
  // resolves any imports the bundle left external — e.g. the runtime package in
  // `runtimes: [juceRuntime(...)]` — from the project's own node_modules.
  const tempPath = resolve(
    dirname(absolute),
    `.soundor.config.${process.pid}.${Date.now()}.mjs`,
  );
  let module: { default?: unknown };
  try {
    await writeFile(tempPath, code, 'utf8');
    module = (await import(pathToFileURL(tempPath).href)) as {
      default?: unknown;
    };
  } catch (cause) {
    throw new ConfigError(
      'load',
      `Failed to evaluate ${absolute}: ${errorMessage(cause)}`,
    );
  } finally {
    await rm(tempPath, { force: true });
  }

  if (module.default === undefined) {
    throw new ConfigError(
      'load',
      `${absolute} has no default export; export your config as \`export default defineSoundorConfig({ ... })\`.`,
    );
  }

  return module.default;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
