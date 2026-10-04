// Modules the runtime's Vite plugin provides to the host's browser code.

declare module 'soundor:internal/manifest' {
  const manifest: import('./manifest').WebManifest;
  export default manifest;
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
