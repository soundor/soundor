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
 * - `'prebuilt'` (default): CMake uses a matching released engine, downloaded
 *   once into the Soundor cache, or compiles modified/unpublished sources.
 * - `'source'`: compiled from the installed `@soundor/engine` sources (in the
 *   pnpm workspace, the local engine), Skia, ANGLE and Hermes included.
 */
export type EngineMode = 'prebuilt' | 'source';

/**
 * What `soundor dev` opens once the plugin is built: the VST3 in
 * `@soundor/vst3-host`, the Standalone, or (`false`) nothing.
 */
export type DevLaunch = 'vst3' | 'standalone' | false;

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
  /** The macOS build. */
  readonly macos?: {
    /**
     * The oldest macOS the plugin runs on. At least the engine's minimum, 12.0.
     * Defaults to `'12.0'`.
     */
    readonly deploymentTarget?: string;
  };
  /**
   * `soundor dev`. `launch` is what it opens once the plugin is built. By
   * default: the VST3 in `@soundor/vst3-host` when `formats` has `vst3` and the
   * project has that package installed, otherwise the Standalone when `formats`
   * has `standalone`, otherwise nothing. A format named here must be in
   * `formats`, and `'vst3'` needs the package.
   */
  readonly dev?: { readonly launch?: DevLaunch };
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
  /** Undefined: decided from the formats and whether the VST3 host is installed. */
  readonly devLaunch?: DevLaunch;
  /** The oldest macOS the plugin runs on (`CMAKE_OSX_DEPLOYMENT_TARGET`). */
  readonly macosDeploymentTarget: string;
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
// The oldest macOS the engine's own code and dependencies are built for.
const ENGINE_MACOS_MINIMUM = '12.0';
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
  const devLaunch = options.dev?.launch;
  if (devLaunch !== undefined && devLaunch !== false) {
    if (devLaunch !== 'vst3' && devLaunch !== 'standalone')
      throw new RuntimeError(
        `juceRuntime({ dev: { launch } }) is "vst3", "standalone" or false, not ${JSON.stringify(devLaunch)}.`,
        { runtimeId: 'juce' },
      );
    if (!formats.includes(devLaunch))
      throw new RuntimeError(
        `juceRuntime({ dev: { launch: "${devLaunch}" } }) needs "${devLaunch}" in formats; they are ${JSON.stringify(formats)}.`,
        { runtimeId: 'juce' },
      );
  }
  const vendor = vendorOf(plugin.id);
  return {
    engineMode,
    jucePath: options.jucePath,
    formats,
    ...(devLaunch === undefined ? {} : { devLaunch }),
    macosDeploymentTarget: macosDeploymentTargetOf(
      options.macos?.deploymentTarget,
    ),
    bundleId: plugin.id,
    pluginName: plugin.name,
    companyName: options.companyName ?? vendor.name,
    pluginCode: fourCharCode(options.pluginCode, plugin.id),
    manufacturerCode: fourCharCode(options.manufacturerCode, vendor.id),
    timeLimit: timeLimitOf(options.timeLimit),
  };
}

function macosDeploymentTargetOf(value: string | undefined): string {
  if (value === undefined) return ENGINE_MACOS_MINIMUM;
  if (typeof value !== 'string' || !/^\d+(\.\d+){0,2}$/.test(value))
    throw new RuntimeError(
      `juceRuntime({ macos: { deploymentTarget } }) is a macOS version such as "13.0"; got ${JSON.stringify(value)}.`,
      { runtimeId: 'juce' },
    );
  const [major = 0, minor = 0] = value.split('.').map(Number);
  const [engineMajor = 0, engineMinor = 0] =
    ENGINE_MACOS_MINIMUM.split('.').map(Number);
  if (major < engineMajor || (major === engineMajor && minor < engineMinor))
    throw new RuntimeError(
      `juceRuntime({ macos: { deploymentTarget } }) is ${value}, but the Soundor engine needs macOS ${ENGINE_MACOS_MINIMUM} or later.`,
      { runtimeId: 'juce' },
    );
  return value;
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
