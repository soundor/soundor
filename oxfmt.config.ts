import { defineConfig } from 'oxfmt';

export default defineConfig({
  printWidth: 80,
  semi: true,
  singleQuote: true,
  sortImports: true,
  sortPackageJson: true,
  // Generated, and compared byte for byte with their generator's output.
  ignorePatterns: [
    'packages/environment/webgl.d.ts',
    'runtimes/web-runtime/src/client/testing/*.{d.ts,json}',
    'runtimes/web-runtime/src/client/testing/parameters.js',
    'engines/engine/src/gpu/webgl/generated/**',
    'engines/yoga-wasm/generated/**',
    // C++ (included into Hermes's hermes.cpp), not JavaScript.
    'engines/engine/cmake/hermes/*.inc',
    // Third-party license texts, verbatim, and generated crate notices.
    'engines/engine/licenses/**',
    'engines/yoga-wasm/licenses/**',
  ],
});
