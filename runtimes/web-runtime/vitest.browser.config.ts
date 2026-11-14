import { defineConfig } from 'vitest/config';

// The suites that run in Chromium, driven from Node by Playwright: the Rust
// processor in a real AudioWorklet. `pnpm test:browser`; they need the
// wasm32-unknown-unknown target and Playwright's Chromium.
export default defineConfig({
  test: {
    include: ['src/**/*.browser.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 300_000,
  },
});
