/**
 * The options a project author passes to `webRuntime({ ... })`: only what is
 * specific to the Web host. The plugin's identity and parameters live at the
 * top level of the Soundor config.
 */

import { ConfigError } from '@soundor/runtime-sdk';

import { validateBuiltinInput, type BuiltinInput } from './input-options';

export interface WebOptions {
  /**
   * The port `soundor dev` serves the Web host on. Defaults to 5173; when it
   * is taken, the next free port is used.
   */
  readonly port?: number;
  /** Built-in sources, or a browser module path relative to the plugin root. Omitted: all defaults; []: no optional sources. */
  readonly inputs?: readonly BuiltinInput[] | string;
}

/** Everything the Web runtime needs, with defaults applied. */
export interface ResolvedWebOptions {
  readonly port: number;
  readonly inputs?: readonly BuiltinInput[] | string;
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
  const inputs = options.inputs;
  try {
    if (typeof inputs === 'string') {
      if (!inputs.trim())
        throw new TypeError('Input module path must not be empty');
    } else if (inputs !== undefined) {
      if (!Array.isArray(inputs))
        throw new TypeError('inputs must be a built-in array or a module path');
      const ids = new Set<string>();
      for (const input of inputs) {
        validateBuiltinInput(input);
        if (ids.has(input.type))
          throw new TypeError(`Duplicate audio input id: ${input.type}`);
        ids.add(input.type);
      }
    }
  } catch (error) {
    throw new ConfigError(
      'validation',
      `Invalid webRuntime() inputs: ${(error as Error).message}`,
    );
  }
  return { port, inputs };
}
