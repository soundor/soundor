import { dirname, resolve } from 'node:path';

import { loadConfigModule, locateConfig } from './load';
import { checkProjectConfigVersion } from './project';
import { validateConfig } from './schema';
import type { SoundorConfig } from './types';

export interface ParseConfigOptions {
  /** Directory to start config discovery from. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Explicit path to a config file. When set, discovery is skipped. */
  path?: string;
}

/**
 * Loads `soundor.config.ts` from disk, evaluates it in-process, and validates
 * it into a normalized, deterministic {@link SoundorConfig}.
 *
 * Throws {@link ConfigError} for every failure (missing file, a project
 * `@soundor/config` of another release line than this one, unloadable module,
 * invalid config) with structured issues a CLI can surface.
 *
 * No network access, no file writes, no side effects.
 */
export async function parseConfig(
  options: ParseConfigOptions = {},
): Promise<SoundorConfig> {
  const path = options.path ?? locateConfig(options.cwd ?? process.cwd());
  checkProjectConfigVersion(dirname(resolve(path)));
  const raw = await loadConfigModule(path);
  return validateConfig(raw);
}
