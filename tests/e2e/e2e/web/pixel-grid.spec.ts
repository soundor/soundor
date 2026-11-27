// Layout on the device-pixel grid at fractional scales (issue 405): boxes
// centred in one parent keep a common centre, and nodes with the same style
// get the same pixels, whatever their type. Read from where the DOM adapter
// put them, in the browser's own layout.
import { expect, test, type Page } from '@playwright/test';

import { byDebugId, openPlugin } from './plugin';

async function box(page: Page, id: string) {
  const found = await byDebugId(page, id).boundingBox();
  if (found === null) throw new Error(`${id} is not shown`);
  return found;
}

const centre = (b: {
  x: number;
  y: number;
  width: number;
  height: number;
}) => ({
  x: b.x + b.width / 2,
  y: b.y + b.height / 2,
});

for (const scale of [1.25, 1.5]) {
  test.describe(`at a scale of ${scale}`, () => {
    test.use({ deviceScaleFactor: scale });

    test('a ring centred over a disc stays on its centre', async ({ page }) => {
      await openPlugin(page);
      expect(await page.evaluate(() => window.devicePixelRatio)).toBe(scale);
      const ring = centre(await box(page, 'pixel-grid.ring'));
      const disc = centre(await box(page, 'pixel-grid.disc'));
      // Exactly, though 26 and 20 differ by an odd number of device pixels
      // at both scales: one of them is a device pixel larger. Chromium lays
      // out in 1/64 px, which it snaps away when it paints.
      const layoutUnit = 1 / 64 + 1e-3;
      expect(Math.abs(ring.x - disc.x)).toBeLessThanOrEqual(layoutUnit);
      expect(Math.abs(ring.y - disc.y)).toBeLessThanOrEqual(layoutUnit);
    });

    test('the view starts on a device pixel', async ({ page }) => {
      await openPlugin(page);
      const origin = await page
        .locator('.sd-root')
        .first()
        .evaluate((root) => root.getBoundingClientRect());
      for (const at of [origin.x, origin.y])
        expect(Math.abs(at * scale - Math.round(at * scale))).toBeLessThan(
          0.05,
        );
    });

    test('an Svg and a View with the same style cover the same pixels', async ({
      page,
    }) => {
      await openPlugin(page);
      expect(await box(page, 'pixel-grid.svg')).toEqual(
        await box(page, 'pixel-grid.view'),
      );
    });
  });
}
