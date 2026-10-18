import assert from 'node:assert/strict';

// Optional real-browser coverage using an existing Playwright installation.
// The normal JUCE test workflow needs no browser download or browser dependency.
export async function inspectInBrowser(server, nativeOutput) {
  const { chromium } = await import(process.env.SOUNDOR_PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless: true });
  try {
    const errors = [];
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(server.browserLaunchUrl());
    await page.locator('.tree-row').first().waitFor();
    await page
      .getByRole('button', { name: 'Performance', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Start recording', exact: true })
      .click();
    await page
      .getByText('Recording · 10 Hz samples', { exact: true })
      .waitFor();
    await page
      .locator('#performance-summary')
      .filter({ hasText: 'CPU frame (ms)' })
      .waitFor();
    await page.getByRole('button', { name: 'Animations', exact: true }).click();
    await page.locator('#animations').filter({ hasText: 'opacity' }).waitFor();
    await page
      .getByRole('button', { name: 'Select element', exact: true })
      .click();
    await page
      .locator('.tree-row[aria-selected=true]')
      .filter({ hasText: '#reset' })
      .waitFor();
    await page.getByText('Properties', { exact: true }).waitFor();
    await page
      .getByRole('button', { name: 'Performance', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Stop recording', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Start recording', exact: true })
      .waitFor();
    assert.match(nativeOutput(), /PICKED applicationEvents=0/);
    if (process.env.SOUNDOR_DEVTOOLS_SCREENSHOT)
      await page.screenshot({ path: process.env.SOUNDOR_DEVTOOLS_SCREENSHOT });
    const observer = await context.newPage();
    observer.on('pageerror', (error) => errors.push(error.message));
    await observer.goto(server.url);
    // A second tab works beside the first, with its own picker.
    await observer.locator('.tree-row').first().waitFor();
    await observer
      .getByRole('button', { name: 'Select element', exact: true })
      .click();
    await observer
      .getByRole('button', { name: 'Cancel picker (Escape)', exact: true })
      .waitFor();
    await page
      .locator('#target-meta')
      .filter({ hasText: 'generation 2' })
      .waitFor();
    await page
      .getByText('Select a node to inspect its live engine state.', {
        exact: true,
      })
      .waitFor();
    await page.getByRole('button', { name: 'Console', exact: true }).click();
    server.publishLog({
      level: 'error',
      source: 'application',
      message: 'Error: smoke\n  at src/main.tsx:12:3',
    });
    await page
      .locator('#logs')
      .filter({ hasText: 'src/main.tsx:12:3' })
      .waitFor();
    assert.deepEqual(errors, []);
    console.log(
      'PASS: Chromium + real native tree, picker synchronization, zero application events, two tabs side by side, reload, mapped logs, no page errors',
    );
  } finally {
    await browser.close();
  }
}
