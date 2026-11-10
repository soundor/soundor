/**
 * The project's own `@soundor/config`, which its `soundor.config.ts` is typed
 * against. The host never loads it (the config's import of it is replaced by
 * a shim when it is evaluated), but its version says which schema the config
 * was written for, so it must be of the host's release line.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { sameReleaseLine } from '@soundor/core';

import { ConfigError } from './errors';
import { CONFIG_VERSION } from './version';

const PACKAGE = '@soundor/config';

/**
 * The version of the `@soundor/config` a project at `dir` installed, found as
 * Node would from there (`node_modules/@soundor/config` in `dir` or above),
 * or `undefined` when there is none.
 */
export function projectConfigVersion(dir: string): string | undefined {
  let current = resolve(dir);
  for (;;) {
    const manifest = join(current, 'node_modules', PACKAGE, 'package.json');
    if (existsSync(manifest)) {
      try {
        const { version } = JSON.parse(readFileSync(manifest, 'utf8')) as {
          version?: unknown;
        };
        if (typeof version === 'string') return version;
      } catch {
        // An unreadable manifest is not an installed package; keep looking.
      }
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * Throws {@link ConfigError} of kind `compatibility` when the project at `dir`
 * installed a `@soundor/config` of another release line than `host` (the
 * same minor before 1.0): its config may use what the host's schema does not
 * have, or lack what it requires. A project without one passes: nothing of it
 * would run.
 */
export function checkProjectConfigVersion(
  dir: string,
  host: string = CONFIG_VERSION,
): void {
  const found = projectConfigVersion(dir);
  if (found === undefined || sameReleaseLine(found, host)) return;
  throw new ConfigError(
    'compatibility',
    `This project's ${PACKAGE} is ${found}, but soundor reads configs with ${PACKAGE} ${host}.`,
    [
      {
        path: '',
        message: `Install soundor and ${PACKAGE} at the same version (the Soundor packages are released together), for example ${PACKAGE}@${host}.`,
      },
    ],
  );
}
