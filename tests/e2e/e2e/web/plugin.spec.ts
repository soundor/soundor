// The plugin in the web runtime: the engine's WebAssembly core lays it out
// and its DOM adapter shows it, with the browser's drawing, input and ARIA.
import { expect, test } from '@playwright/test';

import { coverage, decodePng } from '../support/pixels';
import { byDebugId, collectErrors, openPlugin } from './plugin';

test('each way of drawing shows its color', async ({ page }) => {
  await openPlugin(page);
  await expect(byDebugId(page, 'webgl.status')).toHaveText('WebGL 2');

  for (const [id, color] of [
    ['swatch.view', '#ff0000'],
    ['swatch.canvas', '#00ff00'],
    ['swatch.webgl', '#0000ff'],
    ['swatch.image', '#ff00ff'],
  ] as const)
    await expect
      .poll(async () =>
        coverage(decodePng(await byDebugId(page, id).screenshot()), color),
      )
      .toBe(1);
});

test('the language and the Web globals pass their checks', async ({ page }) => {
  await openPlugin(page);

  await expect(byDebugId(page, 'checks')).toHaveText(
    /^JavaScript: (\d+) of \1 passed$/,
    { timeout: 10_000 },
  );
});

test('controls take the pointer and the keyboard, as ARIA says', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openPlugin(page);
  const slider = page.getByRole('slider', { name: 'Gain', exact: true });
  const bypass = page.getByRole('button', { name: 'Bypass', exact: true });

  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuetext', '1.02x');
  await page.keyboard.press('Home');
  await expect(slider).toHaveAttribute('aria-valuetext', '1.00x');

  await bypass.click();
  await expect(bypass).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('radio', { name: 'Invert', exact: true }).click();
  await expect(
    page.getByRole('radio', { name: 'Invert', exact: true }),
  ).toBeChecked();

  const note = page.getByRole('textbox', { name: 'Note', exact: true });
  await note.click();
  await page.keyboard.type('typed in the browser');
  await page.keyboard.press('Enter');
  await expect(byDebugId(page, 'note')).toHaveText(
    'Note: typed in the browser',
  );
  expect(errors).toEqual([]);
});

test('the Rust controller answers, and the processor streams what it plays', async ({
  page,
}) => {
  await openPlugin(page);
  await page.getByRole('button', { name: 'Count later', exact: true }).click();
  await expect(byDebugId(page, 'native.count')).toHaveText('Counted 1');
  await expect(byDebugId(page, 'native.event')).toHaveText('Event 1');

  await page.getByRole('button', { name: 'Play', exact: true }).click();

  // The test tone, at full scale, through Gain 1.
  await expect(byDebugId(page, 'native.peak')).toHaveText(
    /^Peak (0\.9|1\.0)\d\d$/,
  );
  await expect(byDebugId(page, 'native.scope')).toHaveText(
    /^Scope 64 samples, first -?[01]\.\d{3}$/,
  );
});

test("the host's preset selector loads a factory preset and follows the plugin's", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openPlugin(page);
  await page
    .getByRole('button', { name: 'Host settings', exact: true })
    .click();
  const preset = page.getByLabel('Preset', { exact: true });
  await expect(preset).toHaveValue('unity');

  await preset.selectOption('quiet-invert');
  await expect(byDebugId(page, 'preset.current')).toHaveText('Quiet invert');
  await expect(byDebugId(page, 'note')).toHaveText('Note: Quiet invert');

  // Loaded by the plugin, the host shows it; changed after, modified.
  await page.getByRole('button', { name: 'Unity', exact: true }).click();
  await expect(preset).toHaveValue('unity');
  await page.getByRole('button', { name: 'Bypass', exact: true }).click();
  await expect(byDebugId(page, 'preset.current')).toHaveText(
    'Unity (modified)',
  );
  await expect(preset.locator('option:checked')).toHaveText('Unity (modified)');
  expect(errors).toEqual([]);
});
