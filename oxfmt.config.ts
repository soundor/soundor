import { defineConfig } from 'oxfmt';

export default defineConfig({
  printWidth: 80,
  semi: true,
  singleQuote: true,
  sortImports: true,
  sortPackageJson: true,
  // Generated, and compared byte for byte with their generator's output.
  ignorePatterns: [
    'packages/core/runtime/**',
    'runtimes/web-runtime/src/client/testing/*.{d.ts,json}',
    'runtimes/juce-runtime/native/src/gpu/webgl/generated/**',
    // C++ (included into Hermes's hermes.cpp), not JavaScript.
    'runtimes/juce-runtime/native/cmake/hermes/*.inc',
    'packages/core/src/webgl-dts.ts',
  ],
});
