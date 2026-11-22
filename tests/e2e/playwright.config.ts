import { defineConfig, devices } from '@playwright/test';

/**
 * The plugin's web build in Chromium: the engine's WebAssembly core and DOM
 * adapter, the web runtime's host and its audio inputs. `pnpm test:web`
 * builds it first.
 */
export default defineConfig({
  testDir: './e2e/web',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['github']] : 'list',
  use: {
    baseURL: 'http://localhost:4175',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/serve.ts 4175',
    url: 'http://localhost:4175/',
    reuseExistingServer: !process.env['CI'],
  },
});
