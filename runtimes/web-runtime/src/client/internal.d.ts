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
