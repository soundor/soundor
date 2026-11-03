import { defineConfig } from 'vitest/config';

// Unit tests: no native build, no executable.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    // npm pack and a local registry: slower on CI runners.
    testTimeout: 60_000,
  },
});
