import { join } from 'node:path';

import { defineConfig } from 'vitest/config';

// The engine in Node: its WebAssembly module (`pnpm build:wasm` first), the
// core through its commands, and soundor:ui's DOM adapter in happy-dom, with
// the engine's text approximation (happy-dom has no canvas to measure with).
export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.browser.test.ts'],
    setupFiles: ['test/setup.ts'],
    env: {
      SOUNDOR_ENGINE_WASM:
        process.env['SOUNDOR_ENGINE_WASM'] ??
        join(import.meta.dirname, '../build/wasm/web/soundor-core.wasm'),
    },
  },
});
