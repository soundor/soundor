/**
 * Runtime-agnostic bridge injection. A runtime advertises a browser bridge
 * module via its `bridgeModule()` seam; this Vite plugin exposes that module to
 * the UI under the stable virtual id `virtual:soundor/bridge`, so a React app
 * imports its transport without knowing which runtime is active:
 *
 * ```ts
 * import { bridge } from 'virtual:soundor/bridge';
 * ```
 *
 * The runtime's module must export a ready `bridge` binding (the CLI re-exports
 * it as the default too). When no runtime supplies one — a plain preview — the
 * plugin falls back to the in-memory mock so the UI still renders.
 */

import type { Plugin } from 'vite';

export const SOUNDOR_BRIDGE_ID = 'virtual:soundor/bridge';
// Vite convention: resolved virtual ids are prefixed with a NUL byte.
const RESOLVED_ID = `\0${SOUNDOR_BRIDGE_ID}`;

export interface SoundorBridgePluginOptions {
  /** Module specifier a runtime returned from `bridgeModule()`, if any. */
  readonly entry?: string | undefined;
}

/** Creates the `virtual:soundor/bridge` provider plugin. */
export function soundorBridgePlugin(
  options: SoundorBridgePluginOptions = {},
): Plugin {
  const { entry } = options;
  return {
    name: 'soundor:bridge',
    resolveId(id) {
      return id === SOUNDOR_BRIDGE_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_ID) return undefined;
      if (entry) {
        const spec = JSON.stringify(entry);
        return `export * from ${spec};\nexport { bridge as default } from ${spec};\n`;
      }
      return (
        `import { createMockBridge } from '@soundor/bridge';\n` +
        `export const bridge = createMockBridge({ parameters: {} });\n` +
        `export default bridge;\n`
      );
    },
  };
}
