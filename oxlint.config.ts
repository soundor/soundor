import { defineConfig } from 'oxlint';

export default defineConfig({
  env: {
    browser: true,
    es2024: true,
    node: true,
  },
  plugins: ['typescript', 'react', 'import', 'vitest'],
  // Generated from the modules next to them (scripts/native-modules.mjs).
  ignorePatterns: ['runtimes/juce-runtime/native/src/generated/**'],
  settings: {
    react: {
      version: '19.2.3',
    },
  },
});
