/**
 * The options a project author passes to `juceRuntime({ ... })`: only what is
 * specific to JUCE. The plugin's identity (`plugin.id`, `plugin.name`) lives at
 * the top level of the Soundor config, and JUCE's identifiers default from it.
 */

import { createHash } from 'node:crypto';

import type { SoundorConfig } from '@soundor/runtime-sdk';

/** Plugin binary formats JUCE can emit. */
export type JuceFormat = 'vst3' | 'au' | 'standalone';

export interface JuceOptions {
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
}

/** Everything the JUCE runtime needs, with defaults applied. */
export interface ResolvedJuceOptions {
  readonly jucePath?: string;
  readonly formats: readonly JuceFormat[];
  /** `plugin.id`, used as the bundle identifier. */
  readonly bundleId: string;
  /** `plugin.name`. */
  readonly pluginName: string;
  readonly companyName: string;
  readonly pluginCode: string;
  readonly manufacturerCode: string;
}

const DEFAULT_FORMATS: readonly JuceFormat[] = ['vst3'];

/** Applies defaults to a raw {@link JuceOptions} bag for the given plugin. */
export function resolveJuceOptions(
  options: JuceOptions,
  plugin: SoundorConfig['plugin'],
): ResolvedJuceOptions {
  const formats =
    options.formats && options.formats.length > 0
      ? [...options.formats]
      : [...DEFAULT_FORMATS];
  const vendor = vendorOf(plugin.id);
  return {
    jucePath: options.jucePath,
    formats,
    bundleId: plugin.id,
    pluginName: plugin.name,
    companyName: options.companyName ?? vendor.name,
    pluginCode: fourCharCode(options.pluginCode, plugin.id),
    manufacturerCode: fourCharCode(options.manufacturerCode, vendor.id),
  };
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
