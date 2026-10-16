/**
 * The options a project author passes to `juceRuntime({ ... })`: only what is
 * specific to JUCE. The plugin's identity (`plugin.id`, `plugin.name`) lives at
 * the top level of the Soundor config, and JUCE's identifiers default from it.
 */

import { createHash } from 'node:crypto';

import { RuntimeError } from '@soundor/core';
import type { SoundorConfig } from '@soundor/runtime-sdk';

/** Plugin binary formats JUCE can emit. */
export type JuceFormat = 'vst3' | 'au' | 'standalone';

/**
 * Where the native engine comes from:
 * - `'prebuilt'` (default): the verified libraries of the prebuilt release the
 *   installed `@soundor/engine` names, downloaded once into the Soundor cache.
 * - `'source'`: compiled from the installed `@soundor/engine` sources (in the
 *   pnpm workspace, the local engine), Skia, ANGLE and Hermes included.
 */
export type EngineMode = 'prebuilt' | 'source';

export interface JuceOptions {
  /** Where the native engine comes from. Defaults to `{ mode: 'prebuilt' }`. */
  readonly engine?: { readonly mode: EngineMode };
  /**
   * Absolute or project-relative path to a JUCE checkout. When omitted, the
   * runtime searches `JUCE_DIR` and well-known locations. JUCE is never
   * downloaded — its license requires explicit acceptance.
   */
  readonly jucePath?: string;
  /** Formats to build. Defaults to `['vst3']`. */
  readonly formats?: readonly JuceFormat[];
  /** Company name hosts show (JUCE `COMPANY_NAME`). Defaults to the vendor segment of `plugin.id`. */
  readonly companyName?: string;
  /**
   * Four-character plugin code (JUCE `PLUGIN_CODE`). Defaults to a code derived
   * from `plugin.id`, so distinct plugins never share one.
   */
  readonly pluginCode?: string;
  /**
   * Four-character manufacturer code (JUCE `PLUGIN_MANUFACTURER_CODE`). Defaults
   * to a code derived from the vendor part of `plugin.id`, shared by every
   * plugin of that vendor.
   */
  readonly manufacturerCode?: string;
  /**
   * How long, in milliseconds, one call into the UI's JavaScript may run (a
   * frame, an event, startup) before the runtime stops it. JavaScript runs on
   * the host's UI thread, so a script that never returns would freeze the
   * host's whole UI; stopped, it throws a `TimeoutError` JavaScript cannot
   * catch, the error is logged, and the UI stays as it was until the editor
   * is opened again (or `soundor dev` reloads it). `false`: no limit.
   * Defaults to 5000, about when an operating system shows a window as not
   * responding.
   */
  readonly timeLimit?: number | false;
}

/** Everything the JUCE runtime needs, with defaults applied. */
export interface ResolvedJuceOptions {
  readonly engineMode: EngineMode;
  readonly jucePath?: string;
  readonly formats: readonly JuceFormat[];
  /** `plugin.id`, used as the bundle identifier. */
  readonly bundleId: string;
  /** `plugin.name`. */
  readonly pluginName: string;
  readonly companyName: string;
  readonly pluginCode: string;
  readonly manufacturerCode: string;
  /** Milliseconds; 0: no limit. */
  readonly timeLimit: number;
}

const DEFAULT_FORMATS: readonly JuceFormat[] = ['vst3'];
const DEFAULT_TIME_LIMIT_MS = 5000;
// What the engine's deadline holds (a 32-bit count of milliseconds).
const MAX_TIME_LIMIT_MS = 2 ** 32 - 1;

/** Applies defaults to a raw {@link JuceOptions} bag for the given plugin. */
export function resolveJuceOptions(
  options: JuceOptions,
  plugin: SoundorConfig['plugin'],
): ResolvedJuceOptions {
  const engineMode = options.engine?.mode ?? 'prebuilt';
  if (engineMode !== 'prebuilt' && engineMode !== 'source')
    throw new RuntimeError(
      `juceRuntime({ engine: { mode } }) is "prebuilt" or "source", not ${JSON.stringify(engineMode)}.`,
      { runtimeId: 'juce' },
    );
  const formats =
    options.formats && options.formats.length > 0
      ? [...options.formats]
      : [...DEFAULT_FORMATS];
  const vendor = vendorOf(plugin.id);
  return {
    engineMode,
    jucePath: options.jucePath,
    formats,
    bundleId: plugin.id,
    pluginName: plugin.name,
    companyName: options.companyName ?? vendor.name,
    pluginCode: fourCharCode(options.pluginCode, plugin.id),
    manufacturerCode: fourCharCode(options.manufacturerCode, vendor.id),
    timeLimit: timeLimitOf(options.timeLimit),
  };
}

function timeLimitOf(value: number | false | undefined): number {
  if (value === undefined) return DEFAULT_TIME_LIMIT_MS;
  if (value === false) return 0;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > MAX_TIME_LIMIT_MS
  )
    throw new RuntimeError(
      `juceRuntime({ timeLimit }) must be a whole number of milliseconds from 1 to ${MAX_TIME_LIMIT_MS}, or false for no limit; got ${String(value)}.`,
      { runtimeId: 'juce' },
    );
  return value;
}

/** `com.acme.reverb` → vendor id `com.acme`, name `acme`. */
function vendorOf(pluginId: string): { id: string; name: string } {
  const segments = pluginId.split('.');
  const vendorSegments = segments.length > 1 ? segments.slice(0, -1) : segments;
  return {
    id: vendorSegments.join('.'),
    name: vendorSegments[vendorSegments.length - 1] ?? pluginId,
  };
}

/**
 * JUCE codes must be exactly four characters, and Audio Units require an
 * upper-case letter (exactly one, for plugin codes). An explicit value is
 * padded/truncated so a malformed option can never emit an invalid CMake call;
 * otherwise a stable code is derived from `seed`: one upper-case letter followed
 * by three lower-case letters or digits.
 */
export function fourCharCode(value: string | undefined, seed: string): string {
  if (value !== undefined && value.length > 0) {
    if (value.length === 4) return value;
    return value.length > 4 ? value.slice(0, 4) : value.padEnd(4, 'x');
  }
  const digest = createHash('sha256').update(seed, 'utf8').digest();
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const rest = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return (
    upper[digest[0]! % upper.length]! +
    rest[digest[1]! % rest.length]! +
    rest[digest[2]! % rest.length]! +
    rest[digest[3]! % rest.length]!
  );
}
