import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

import { soundorModules } from './src/plugin.ts';

export default defineConfig({
  // Client tests import soundor:* as plugin code does, resolved by the
  // runtime's own Vite plugin for the fixture plugin.
  plugins: [
    soundorModules({
      genDir: fileURLToPath(new URL('./src/client/testing', import.meta.url)),
      clientDir: fileURLToPath(new URL('./src/client', import.meta.url)),
      // The engine's WebAssembly, read from its file: the tests run in Node.
      engine: { inline: true },
    }),
  ],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // In Chromium: `test:browser`, vitest.browser.config.ts.
    exclude: ['src/**/*.browser.test.ts'],
    // soundor:ui needs the engine's WebAssembly loaded, as the Web host does.
    setupFiles: ['src/client/testing/engine.ts'],
  },
});
