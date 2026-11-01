import { expect, test } from '@playwright/test';

const PAGE = '/examples/primitives/index.html?embed';
const LABEL = 'SVG mountain landscape';

for (const deviceScaleFactor of [1, 2]) {
  test.describe(`SVG Image at DPR ${deviceScaleFactor}`, () => {
    test.use({ deviceScaleFactor });

    test('loads the bundled SVG and updates its layout through React', async ({
      page,
    }) => {
      await page.goto(PAGE);
      const image = page.getByRole('img', { name: LABEL });
      await image.scrollIntoViewIfNeeded();
      await image.evaluate((element) => (element as HTMLImageElement).decode());
      expect(await image.evaluate((element) => element.tagName)).toBe('IMG');
      expect(
        await image.evaluate((element) => [
          (element as HTMLImageElement).naturalWidth,
          (element as HTMLImageElement).naturalHeight,
        ]),
      ).toEqual([240, 120]);
      const source = await image.getAttribute('src');
      expect(source).toMatch(/soundor-assets\/[0-9a-f]{16}\.svg$/);
      await expect(image).toHaveCSS('width', '320px');
      await page.getByText('Resize SVG image', { exact: true }).click();
      await expect(image).toHaveCSS('width', '160px');
      expect(await image.getAttribute('src')).toBe(source);
      const pixels = await image.evaluate((element) => {
        const canvas = document.createElement('canvas');
        canvas.width = 240;
        canvas.height = 120;
        const context = canvas.getContext('2d')!;
        context.drawImage(element as HTMLImageElement, 0, 0);
        return {
          corner: [...context.getImageData(0, 0, 1, 1).data],
          sky: [...context.getImageData(30, 20, 1, 1).data],
        };
      });
      expect(pixels.corner[3]).toBe(0);
      expect(pixels.sky[2]).toBeGreaterThan(100);
      expect(pixels.sky[3]).toBe(255);
    });

    test('screenshots stay sharp after a small draw and host presentation scaling', async ({
      page,
    }) => {
      await page.goto(PAGE);
      const image = page.getByRole('img', { name: LABEL });
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><rect width="8" height="8" fill="white"/><circle cx="4" cy="4" r="3" fill="red"/></svg>';
      await page.route('**/soundor-assets/ffffffffffffffff.svg', (route) =>
        route.fulfill({ contentType: 'image/svg+xml', body: svg }),
      );
      await image.evaluate(async (element) => {
        const img = element as HTMLImageElement;
        img.src = new URL(
          'soundor-assets/ffffffffffffffff.svg',
          document.baseURI,
        ).href;
        img.style.width = '8px';
        img.style.height = '8px';
        await img.decode();
      });
      await image.screenshot(); // exercise a small initial rendering/cache
      await image.evaluate((element) => {
        const img = element as HTMLImageElement;
        img.style.width = '64px';
        img.style.height = '64px';
      });
      for (const scale of [0.5, 1, 1.5, 2]) {
        // The scale editor uses this host presentation transform. Dimensions
        // remain logical; test the actual composited PNG, not drawImage().
        await page.locator('.soundor-viewport').evaluate((element, zoom) => {
          const viewport = element as HTMLElement;
          viewport.style.transformOrigin = '0 0';
          viewport.style.transform = `scale(${zoom})`;
        }, scale);
        await image.scrollIntoViewIfNeeded();
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );
        const screenshot = (
          await image.screenshot({ scale: 'device' })
        ).toString('base64');
        const sample = await page.evaluate(async (png) => {
          const bitmap = await createImageBitmap(
            await (await fetch(`data:image/png;base64,${png}`)).blob(),
          );
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext('2d')!;
          context.drawImage(bitmap, 0, 0);
          bitmap.close();
          const { data } = context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          );
          const radius = (Math.min(canvas.width, canvas.height) * 3) / 8;
          let wrong = 0;
          for (let y = 2; y < canvas.height - 2; ++y)
            for (let x = 2; x < canvas.width - 2; ++x) {
              const distance = Math.hypot(
                x + 0.5 - canvas.width / 2,
                y + 0.5 - canvas.height / 2,
              );
              const offset = (y * canvas.width + x) * 4;
              if (
                distance < radius - 2.5 &&
                (data[offset + 1]! > 10 || data[offset + 2]! > 10)
              )
                ++wrong;
              if (
                distance > radius + 2.5 &&
                (data[offset + 1]! < 245 || data[offset + 2]! < 245)
              )
                ++wrong;
            }
          return { width: canvas.width, height: canvas.height, wrong };
        }, screenshot);
        expect(sample.width).toBeCloseTo(64 * scale * deviceScaleFactor, -1);
        expect(sample.height).toBeCloseTo(64 * scale * deviceScaleFactor, -1);
        expect(
          sample.wrong,
          `blurred pixels at editor scale ${scale}, DPR ${deviceScaleFactor}`,
        ).toBe(0);
      }
    });
  });
}

test('SVG Image cannot execute scripts or load document resources', async ({
  page,
}) => {
  await page.goto(PAGE);
  const attempted: string[] = [];
  page.on('request', (request) => {
    if (
      request.url().startsWith('https://svg-untrusted.invalid/') ||
      request.url().startsWith('file:')
    )
      attempted.push(request.url());
  });
  await page.route('https://svg-untrusted.invalid/**', (route) =>
    route.abort(),
  );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" onload="top.__svgScriptRan=true">
    <script>top.__svgScriptRan=true</script>
    <style>@import url('https://svg-untrusted.invalid/style.css');</style>
    <image href="https://svg-untrusted.invalid/image.png" width="24" height="24"/>
    <use href="https://svg-untrusted.invalid/vector.svg#shape"/>
    <rect width="24" height="24" fill="lime"/>
  </svg>`;
  await page.route('**/soundor-assets/eeeeeeeeeeeeeeee.svg', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: svg }),
  );
  await page.getByRole('img', { name: LABEL }).evaluate(async (element) => {
    const image = element as HTMLImageElement;
    image.src = new URL(
      'soundor-assets/eeeeeeeeeeeeeeee.svg',
      document.baseURI,
    ).href;
    await image.decode();
  });
  expect(await page.evaluate('globalThis.__svgScriptRan')).toBeUndefined();
  expect(attempted).toEqual([]);
  await page.route('**/soundor-assets/dddddddddddddddd.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<!DOCTYPE svg [<!ENTITY outside SYSTEM "https://svg-untrusted.invalid/entity">]><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><text>&outside;</text></svg>',
    }),
  );
  await page.getByRole('img', { name: LABEL }).evaluate(async (element) => {
    const image = element as HTMLImageElement;
    image.src = new URL(
      'soundor-assets/dddddddddddddddd.svg',
      document.baseURI,
    ).href;
    await image.decode().catch(() => {});
  });
  expect(attempted).toEqual([]);
  await page.route('**/soundor-assets/cccccccccccccccc.svg', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: '<svg>' }),
  );
  const invalid = await page
    .getByRole('img', { name: LABEL })
    .evaluate(async (element) => {
      const image = element as HTMLImageElement;
      image.src = new URL(
        'soundor-assets/cccccccccccccccc.svg',
        document.baseURI,
      ).href;
      const decoded = await image.decode().then(
        () => true,
        () => false,
      );
      return { decoded, width: image.naturalWidth };
    });
  expect(invalid).toEqual({ decoded: false, width: 0 });
});
