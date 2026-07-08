/**
 * The options a project author passes to `juceRuntime({ ... })`. Every field is
 * optional; {@link resolveJuceOptions} fills sensible defaults so `juceRuntime()`
 * works out of the box. `options` is the runtime-owned bag core carries opaquely
 * (see `RuntimeConfig.options`).
 */

/** Plugin binary formats JUCE can emit. */
export type JuceFormat = 'vst3' | 'au' | 'standalone';

/** JUCE `juce_add_plugin(...)` options surfaced by this runtime. */
export interface JucePluginOptions {
  /** Formats to build. Defaults to `['vst3']`. */
  readonly formats?: readonly JuceFormat[];
  /** Human-readable plugin name. Defaults to `'SoundorPlugin'`. */
  readonly pluginName?: string;
  /** Company/manufacturer name. Defaults to `'Soundor'`. */
  readonly companyName?: string;
  /** Four-character plugin code (JUCE `PLUGIN_CODE`). Defaults to `'Sndr'`. */
  readonly pluginCode?: string;
  /** Four-character manufacturer code (JUCE `PLUGIN_MANUFACTURER_CODE`). Defaults to `'Sndo'`. */
  readonly manufacturerCode?: string;
}

export interface JuceOptions {
  /**
   * Absolute or project-relative path to a JUCE checkout. When omitted, the
   * runtime searches `JUCE_DIR` and well-known locations. JUCE is never
   * downloaded — its license requires explicit acceptance.
   */
  readonly jucePath?: string;
  /** Options passed through to JUCE's `juce_add_plugin(...)`. */
  readonly plugin?: JucePluginOptions;
}

/** {@link JuceOptions} with every default applied. */
export interface ResolvedJuceOptions {
  readonly jucePath?: string;
  readonly formats: readonly JuceFormat[];
  readonly pluginName: string;
  readonly companyName: string;
  readonly pluginCode: string;
  readonly manufacturerCode: string;
}

const DEFAULT_FORMATS: readonly JuceFormat[] = ['vst3'];

/** Applies defaults to a raw {@link JuceOptions} bag. */
export function resolveJuceOptions(options: JuceOptions): ResolvedJuceOptions {
  const plugin = options.plugin ?? {};
  const formats =
    plugin.formats && plugin.formats.length > 0
      ? [...plugin.formats]
      : [...DEFAULT_FORMATS];
  return {
    jucePath: options.jucePath,
    formats,
    pluginName: plugin.pluginName ?? 'SoundorPlugin',
    companyName: plugin.companyName ?? 'Soundor',
    pluginCode: fourChar(plugin.pluginCode, 'Sndr'),
    manufacturerCode: fourChar(plugin.manufacturerCode, 'Sndo'),
  };
}

/**
 * JUCE plugin/manufacturer codes must be exactly four characters. Falls back to
 * `fallback` when unset; pads/truncates an explicit value to four characters so
 * a malformed option can never emit an invalid CMake target.
 */
function fourChar(value: string | undefined, fallback: string): string {
  if (value === undefined || value.length === 0) return fallback;
  if (value.length === 4) return value;
  return value.length > 4 ? value.slice(0, 4) : value.padEnd(4, 'x');
}
