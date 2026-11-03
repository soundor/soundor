import { defineConfig } from 'vitest/config';

// Integration tests against a built executable and the fixture plugins
// (scripts/native.ts sets SOUNDOR_VST3_HOST_EXECUTABLE and
// SOUNDOR_VST3_HOST_FIXTURES).
export default defineConfig({
  test: {
    include: ['tests/native/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
