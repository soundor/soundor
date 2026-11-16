// Modules the runtime's Vite plugin provides to the host's browser code.

declare module 'soundor:internal/manifest' {
  const manifest: import('./manifest').WebManifest;
  export default manifest;
}

declare module 'soundor:internal/parameters' {
  /** The parameters' generated behavior, in the manifest's order. */
  export const behaviors: readonly import('./parameters').ParameterBehavior[];
}

declare module 'soundor:internal/ui' {
  /** Whether the project has a plugin UI (src/main.ts[x]). */
  export const hasUi: boolean;
  /** Evaluates the CLI's UI bundle. */
  export function loadUi(): Promise<unknown>;
}

declare module 'soundor:internal/dev' {
  /** 'dev' under the dev server, 'demo' in a build. */
  export const presentation: 'demo' | 'dev';
  /** In `soundor dev`: sends a console entry to the terminal. */
  export const sendLog:
    | ((entry: import('./protocol').UiLogEntry) => void)
    | undefined;
}

declare module 'soundor:env' {
  export const env: Readonly<Record<string, string | number | boolean>> & {
    readonly DEV: boolean;
    readonly PROD: boolean;
    readonly MODE: 'development' | 'production';
  };
}

declare module 'soundor:internal/processor' {
  /** The audio processor's WebAssembly module (native/), base64; undefined without one. */
  const wasm: string | undefined;
  export default wasm;
}

declare module 'soundor:internal/engine' {
  /** Where the engine's WebAssembly (soundor-core.wasm) is: a URL, or its bytes in tests. */
  const source: import('@soundor/engine/web').ModuleSource;
  export default source;
}

declare module 'soundor:internal/inputs' {
  const inputs: unknown;
  export default inputs;
}
