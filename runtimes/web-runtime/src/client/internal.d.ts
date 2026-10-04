// Modules the runtime's Vite plugin provides to the host's browser code.

declare module 'soundor:internal/manifest' {
  const manifest: import('./manifest').WebManifest;
  export default manifest;
}
