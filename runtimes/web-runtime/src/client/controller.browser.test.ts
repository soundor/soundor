// The migrated example exercises one config and one Rust controller in the
// actual production browser bundle, including the DOM/UI and Web Audio host.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { chromium, type Browser, type Page } from '@playwright/test';
import { preview, type PreviewServer } from 'vite';
import { afterAll, beforeAll, expect, it } from 'vitest';

let server: PreviewServer;
let browser: Browser;
let page: Page;
const errors: string[] = [];
beforeAll(async () => {
  execFileSync('pnpm', ['--filter', 'controller', 'build:web'], {
    cwd: resolve('../..'),
    stdio: 'pipe',
  });
  server = await preview({
    configFile: false,
    root: resolve('../../examples/controller'),
    build: { outDir: '.soundor/dist/web' },
    preview: { host: '127.0.0.1', port: 0 },
  });
  browser = await chromium.launch();
  page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${server.resolvedUrls!.local[0]}?embed`);
  await page.getByRole('button', { name: 'Click', exact: true }).waitFor();
}, 300_000);
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) =>
    server?.httpServer.close(() => resolve()),
  );
});
it('calls the same Rust sync/async methods and publishes a table from the browser UI', async () => {
  await page.getByRole('button', { name: 'Click', exact: true }).click();
  await expect
    .poll(() => page.getByText('1 clicks', { exact: true }).count())
    .toBe(1);
  await page.getByRole('button', { name: 'Click later', exact: true }).click();
  await expect
    .poll(() => page.getByText('2 clicks', { exact: true }).count())
    .toBe(1);
  await page.getByRole('button', { name: 'square', exact: true }).click();
  await expect
    .poll(() =>
      page
        .getByText('square: 2048 samples · 1 loads, last square', {
          exact: true,
        })
        .count(),
    )
    .toBe(1);
  await page.getByRole('button', { name: 'saw', exact: true }).click();
  await expect
    .poll(() =>
      page
        .getByText('saw: 2048 samples · 2 loads, last saw', { exact: true })
        .count(),
    )
    .toBe(1);
  expect(errors).toEqual([]);
});
