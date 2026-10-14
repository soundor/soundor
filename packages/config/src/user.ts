import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, win32 } from 'node:path';

import { z } from 'zod';

import { ConfigError } from './errors';

const userConfigSchema = z.strictObject({
  devtools: z
    .strictObject({
      enabled: z.boolean().optional(),
      port: z.number().int().min(1).max(65535).optional(),
      open: z.boolean().optional(),
    })
    .optional(),
});

export interface DevToolsSettings {
  readonly enabled: boolean;
  readonly port: number;
  readonly open: boolean;
  /** An explicit default port must still fail on collision. */
  readonly portSource: 'default' | 'config';
}

export interface UserSettings {
  readonly devtools: DevToolsSettings;
}

export interface UserConfigOptions {
  /** Explicit file path takes precedence over platform discovery. */
  readonly path?: string;
  readonly platform?: NodeJS.Platform;
  readonly home?: string;
  readonly env?: NodeJS.ProcessEnv;
}

/** Platform-appropriate user configuration; never searches project ancestors. */
export function userConfigPath(options: UserConfigOptions = {}): string {
  if (options.path !== undefined) return options.path;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  if (platform === 'win32') {
    const appData = env['APPDATA'];
    return win32.join(
      appData && win32.isAbsolute(appData)
        ? appData
        : win32.join(home, 'AppData', 'Roaming'),
      'Soundor',
      'config.json',
    );
  }
  if (platform === 'darwin')
    return join(
      home,
      'Library',
      'Application Support',
      'Soundor',
      'config.json',
    );
  const xdg = env['XDG_CONFIG_HOME'];
  return join(
    xdg && isAbsolute(xdg) ? xdg : join(home, '.config'),
    'soundor',
    'config.json',
  );
}

export function parseUserSettings(raw: unknown): UserSettings {
  const result = userConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(
      'validation',
      'Invalid Soundor user config.',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  const settings = result.data.devtools;
  return {
    devtools: {
      enabled: settings?.enabled ?? true,
      port: settings?.port ?? 4545,
      open: settings?.open ?? false,
      portSource: settings?.port === undefined ? 'default' : 'config',
    },
  };
}

/** Missing files use defaults; malformed or unreadable files are actionable errors. */
export async function loadUserSettings(
  options: UserConfigOptions = {},
): Promise<UserSettings> {
  const path = userConfigPath(options);
  let contents: string;
  try {
    contents = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return parseUserSettings({});
    throw new ConfigError(
      'load',
      `Could not read Soundor user config at ${path}. Check file permissions.`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch {
    throw new ConfigError(
      'load',
      `Invalid JSON in Soundor user config at ${path}.`,
    );
  }
  try {
    return parseUserSettings(raw);
  } catch (error) {
    if (error instanceof ConfigError)
      throw new ConfigError(
        error.kind,
        `${error.message} File: ${path}`,
        error.issues,
      );
    throw error;
  }
}
