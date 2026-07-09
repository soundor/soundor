import { defineConfig } from 'oxfmt';

export default defineConfig({
  ignorePatterns: ['**/CHANGELOG.md'],
  printWidth: 80,
  semi: true,
  singleQuote: true,
  sortImports: true,
  sortPackageJson: true,
});
