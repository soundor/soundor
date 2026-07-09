/**
 * Runtime-agnostic bridge injection. A runtime advertises a browser bridge
 * module via its `bridgeModule()` seam; this Vite plugin exposes that module to
 * the UI under the stable virtual id `virtual:soundor/bridge`, so a UI imports
 * its transport without knowing which runtime is active:
 *
 * ```ts
 * import { bridge } from 'virtual:soundor/bridge';
 * ```
 *
 * The runtime's module must export a `createBridge(seed)` factory; this plugin
 * calls it with the project's generated `parameters` so a plain browser preview
 * (no native channel) renders with real parameter defaults. When no runtime
 * supplies a module — a plain preview — the plugin falls back to the in-memory
 * mock, seeded with the same generated parameters.
 */

import type { Plugin } from 'vite';

export const SOUNDOR_BRIDGE_ID = 'virtual:soundor/bridge';
// Vite convention: resolved virtual ids are prefixed with a NUL byte.
const RESOLVED_ID = `\0${SOUNDOR_BRIDGE_ID}`;

/**
 * Root-relative specifier of the generated portable `parameters` module
 * (`.soundor/generated/parameters.ts`). Vite resolves the leading `/` against
 * the project root, which is the CLI's Vite root in both dev and build.
 */
export const SOUNDOR_PARAMS_MODULE = '/.soundor/generated/parameters';

export interface SoundorBridgePluginOptions {
  /** Module specifier a runtime returned from `bridgeModule()`, if any. */
  readonly entry?: string | undefined;
  /**
   * Specifier of the generated `parameters` module used to seed the bridge (its
   * `parameters` export). Root-relative (`/.soundor/generated/parameters`) so
   * Vite resolves it against the project root. When omitted the bridge is seeded
   * with an empty parameter set.
   */
  readonly paramsModule?: string | undefined;
}

/** Creates the `virtual:soundor/bridge` provider plugin. */
export function soundorBridgePlugin(
  options: SoundorBridgePluginOptions = {},
): Plugin {
  const { entry, paramsModule } = options;
  return {
    name: 'soundor:bridge',
    resolveId(id) {
      return id === SOUNDOR_BRIDGE_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_ID) return undefined;
      const seed = paramsModule
        ? `import { parameters } from ${JSON.stringify(paramsModule)};\n`
        : `const parameters = {};\n`;
      const factory = entry
        ? `import { createBridge } from ${JSON.stringify(entry)};\n`
        : `import { createMockBridge as createBridge } from '@soundor/bridge';\n`;
      return (
        seed +
        factory +
        `export const bridge = createBridge({ parameters });\n` +
        `export default bridge;\n`
      );
    },
  };
}
