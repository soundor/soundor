import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

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

  let module: { default?: unknown };
  try {
    const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
    module = (await import(url)) as { default?: unknown };
  } catch (cause) {
    throw new ConfigError(
      'load',
      `Failed to evaluate ${absolute}: ${errorMessage(cause)}`,
    );
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
