import { defineConfig } from 'vitest/config';

// The test plugin in the VST3 host (tests/plugin.test.ts): `pnpm test:plugin`
// builds it, then runs these.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
