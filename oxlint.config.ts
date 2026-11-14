import { defineConfig } from 'oxlint';

export default defineConfig({
  env: {
    browser: true,
    es2024: true,
    node: true,
  },
  plugins: ['typescript', 'react', 'import', 'vitest'],
  // Literal module inputs, including deliberately malformed JavaScript.
  ignorePatterns: ['engines/engine/tests/fixtures/**/*.js'],
  rules: {
    // Vitest accepts an optional diagnostic message after the value.
    'vitest/valid-expect': ['warn', { maxArgs: 2 }],
  },
  overrides: [
    {
      // A reassigned ancestor cursor is not a captured alias for callbacks.
      files: [
        'runtimes/web-runtime/src/client/ui/node.ts',
        'packages/test-runtime/src/node.ts',
      ],
      rules: {
        'typescript/no-this-alias': ['warn', { allowedNames: ['node'] }],
      },
    },
    {
      // These compose ambient globals; imports would change their scope.
      files: [
        'packages/environment/index.d.ts',
        'packages/environment/globals.d.ts',
      ],
      rules: { 'typescript/triple-slash-reference': 'off' },
    },
    {
      // The scaffolder replaces the runtime-import placeholder with imports.
      files: ['packages/create-soundor-app/templates/base/soundor.config.ts'],
      rules: { 'no-unused-expressions': 'off' },
    },
  ],
  settings: {
    react: {
      version: '19.2.3',
    },
  },
});
