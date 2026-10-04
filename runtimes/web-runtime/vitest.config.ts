import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

import { soundorModules } from './src/plugin';

export default defineConfig({
  // Client tests import soundor:* as plugin code does, resolved by the
  // runtime's own Vite plugin for the fixture plugin.
  plugins: [
    soundorModules({
      genDir: fileURLToPath(new URL('./src/client/testing', import.meta.url)),
      clientDir: fileURLToPath(new URL('./src/client', import.meta.url)),
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
