import { defineConfig } from 'oxlint';

export default defineConfig({
  env: {
    browser: true,
    es2024: true,
    node: true,
  },
  ignorePatterns: ['**/CHANGELOG.md'],
  plugins: ['typescript', 'react', 'import', 'vitest'],
  settings: {
    react: {
      version: '19.2.3',
    },
  },
});
