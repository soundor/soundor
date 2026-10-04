/**
 * The options a project author passes to `webRuntime({ ... })`: only what is
 * specific to the Web host. The plugin's identity and parameters live at the
 * top level of the Soundor config.
 */

import { ConfigError } from '@soundor/runtime-sdk';

export interface WebOptions {
  /**
   * The port `soundor dev` serves the Web host on. Defaults to 5173; when it
   * is taken, the next free port is used.
   */
  readonly port?: number;
}

/** Everything the Web runtime needs, with defaults applied. */
export interface ResolvedWebOptions {
  readonly port: number;
}

const DEFAULT_PORT = 5173;

/**
 * Applies defaults to a raw {@link WebOptions} bag, rejecting values that
 * cannot work with a {@link ConfigError}.
 */
export function resolveWebOptions(options: WebOptions): ResolvedWebOptions {
  const port = options.port ?? DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigError('validation', 'Invalid webRuntime() options.', [
      {
        path: 'runtimes.web.port',
        message: `must be an integer from 0 to 65535, got ${String(port)}`,
      },
    ]);
  }
  return { port };
}
