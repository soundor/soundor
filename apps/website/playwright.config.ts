import { defineConfig } from '@playwright/test';

/** The built site in a browser, served as GitHub Pages serves it. */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  use: { baseURL: 'http://localhost:4321', headless: true },
  webServer: {
    command: 'node scripts/serve.ts 4321',
    url: 'http://localhost:4321/',
    reuseExistingServer: !process.env['CI'],
  },
});
