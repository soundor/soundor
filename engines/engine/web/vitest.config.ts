import { defineConfig } from 'vitest/config';

// The WebAssembly engine in Node: its module (`pnpm build:wasm` first), driven
// through @soundor/engine/web, with the engine's text approximation.
export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.browser.test.ts'],
  },
});
