import { defineConfig } from 'oxfmt';

export default defineConfig({
  printWidth: 80,
  semi: true,
  singleQuote: true,
  sortImports: true,
  sortPackageJson: true,
  // Generated, and compared byte for byte with their generator's output.
  ignorePatterns: [
    'packages/environment/*.d.ts',
    'runtimes/web-runtime/src/client/testing/*.{d.ts,json}',
    'runtimes/engine/src/gpu/webgl/generated/**',
    // C++ (included into Hermes's hermes.cpp), not JavaScript.
    'runtimes/engine/cmake/hermes/*.inc',
    'packages/core/src/webgl-dts.ts',
    // Third-party license texts, verbatim, and generated crate notices.
    'runtimes/engine/licenses/**',
  ],
});
