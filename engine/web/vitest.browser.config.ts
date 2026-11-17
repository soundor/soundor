import { join } from 'node:path';

import { defineConfig } from 'vitest/config';

// The engine's DOM adapter in Chromium, driven from Node by Playwright: the
// fixture page (fixture/) served by Vite, with the locally built module.
export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ['test/**/*.browser.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      SOUNDOR_ENGINE_WASM:
        process.env['SOUNDOR_ENGINE_WASM'] ??
        join(import.meta.dirname, '../build/wasm/web/soundor-core.wasm'),
    },
  },
});
