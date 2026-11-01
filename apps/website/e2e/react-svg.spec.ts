import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

const fixture = resolve('../../tools/benchmark/.soundor/svg-fixture');
const script = readFileSync(resolve(fixture, 'browser.js'), 'utf8');
const manifest = JSON.parse(
  readFileSync(resolve(fixture, 'manifest.json'), 'utf8'),
) as { assets: { id: string; type: string }[] };
declare global {
  interface Window {
    soundorSvgProbe: {
      run(mode: string): {
        sameRoot: boolean;
        children: number;
        width: number;
        connected: boolean;
        unmounted: boolean;
      };
    };
  }
}
for (const deviceScaleFactor of [1, 2]) {
  test.describe(`React SVG at DPR ${deviceScaleFactor}`, () => {
    test.use({ deviceScaleFactor, viewport: { width: 480, height: 240 } });
    test('renders the shared native fixture, updates React children and stays sharp while presented at editor scales', async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route(
        (url) => url.pathname === '/svg-react-probe.js',
        (route) =>
          route.fulfill({ contentType: 'text/javascript', body: script }),
      );
      for (const asset of manifest.assets)
        await page.route(`**/soundor-assets/${asset.id}`, (route) =>
          route.fulfill({
            contentType: asset.type,
            body: readFileSync(resolve(fixture, 'assets', asset.id)),
          }),
        );
      await page.goto(
        '/examples/primitives/index.html?embed&playground=/svg-react-probe.js',
      );
      const svg = page.getByRole('button', { name: 'React vector probe' });
      const image = page.getByRole('img', { name: 'SVG document probe' });
      await expect(svg).toHaveCSS('width', '8px');
      await svg.screenshot();
      const result = await page.evaluate(() =>
        window.soundorSvgProbe.run('grow'),
      );
      expect(result).toMatchObject({ sameRoot: true, children: 0, width: 100 });
      await expect(svg).toHaveCSS('width', '100px');
      expect(await svg.evaluate((el) => el.namespaceURI)).toBe(
        'http://www.w3.org/2000/svg',
      );
      await image.evaluate((el) => (el as HTMLImageElement).decode());
      async function decode(png: Buffer) {
        return page.evaluate(async (base64) => {
          const bitmap = await createImageBitmap(
            await (await fetch('data:image/png;base64,' + base64)).blob(),
          );
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext('2d')!;
          context.drawImage(bitmap, 0, 0);
          bitmap.close();
          return {
            width: canvas.width,
            height: canvas.height,
            data: Array.from(
              context.getImageData(0, 0, canvas.width, canvas.height).data,
            ),
          };
        }, png.toString('base64'));
      }
      for (const scale of [0.5, 1, 1.5, 2]) {
        await page.locator('.soundor-viewport').evaluate((el, value) => {
          (el as HTMLElement).style.transformOrigin = '0 0';
          (el as HTMLElement).style.transform = `scale(${value})`;
        }, scale);
        const actualPng = await svg.screenshot({ scale: 'device' }),
          referencePng = await image.screenshot({ scale: 'device' });
        await test.info().attach(`react-${scale}`, {
          body: actualPng,
          contentType: 'image/png',
        });
        await test.info().attach(`image-${scale}`, {
          body: referencePng,
          contentType: 'image/png',
        });
        const actual = await decode(actualPng),
          reference = await decode(referencePng);
        expect(actual.width).toBe(100 * scale * deviceScaleFactor);
        expect(actual.height).toBe(actual.width);
        expect(reference.width).toBe(actual.width);
        let worst = 0,
          sum = 0,
          different = 0;
        for (let index = 0; index < actual.data.length; index++) {
          const difference = Math.abs(
            actual.data[index]! - reference.data[index]!,
          );
          sum += difference;
          if (difference > 32) different++;
          worst = Math.max(worst, difference);
        }
        // Inline vectors and decoded SVG images may differ at curve edges.
        // Bound total error, then independently reject blur in solid interiors.
        expect(
          sum / actual.data.length,
          `DPR ${deviceScaleFactor}, scale ${scale}, max channel ${worst}`,
        ).toBeLessThan(0.1);
        expect(different / actual.data.length).toBeLessThan(0.001);
        let blurred = 0;
        for (let y = 0; y < actual.height; y++)
          for (let x = 0; x < actual.width; x++) {
            const lx = ((x + 0.5) * 100) / actual.width,
              ly = ((y + 0.5) * 100) / actual.height;
            if (
              lx < 20 ||
              lx > 80 ||
              ly < 25 ||
              ly > 75 ||
              (lx > 40 && lx < 60 && ly > 40 && ly < 60)
            )
              continue;
            if (
              Math.hypot(
                x + 0.5 - actual.width / 2,
                y + 0.5 - actual.height / 2,
              ) >=
              actual.width * 0.4 - 2.5
            )
              continue;
            const offset = (y * actual.width + x) * 4;
            if (
              actual.data[offset]! < 245 ||
              actual.data[offset + 1]! > 10 ||
              actual.data[offset + 2]! > 10 ||
              actual.data[offset + 3]! < 245
            )
              blurred++;
          }
        expect(blurred).toBe(0);
      }
      await page
        .locator('.soundor-viewport')
        .evaluate((el) => ((el as HTMLElement).style.transform = ''));
      await svg.click();
      expect(await svg.locator('circle').count()).toBe(2);
      await expect(svg.locator('circle').first()).toHaveCSS(
        'fill',
        'rgb(0, 0, 255)',
      );
      await page.evaluate(() => window.soundorSvgProbe.run('reorder'));
      expect(
        await svg.locator('svg > g > rect').last().getAttribute('fill'),
      ).toBe('red');
      const cleared = await page.evaluate(() =>
        window.soundorSvgProbe.run('clear'),
      );
      expect(cleared).toMatchObject({
        sameRoot: true,
        unmounted: true,
        connected: false,
        children: 0,
      });
      await expect(svg).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });
}

test('the original SVG control exposes its state and responds to pointer and keyboard input', async ({
  page,
}) => {
  await page.goto('/examples/primitives/index.html?embed');
  const toggle = page.getByRole('button', {
    name: 'Vector toggle',
    exact: true,
  });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
});
