import { expect, test } from '@playwright/test';

for (const width of [400, 800]) {
  test(`scrollbars stay at the border and above scrolling content at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 600 });
    await page.goto('/examples/primitives/index.html?embed');
    const node = (id: string) =>
      page.locator(`[data-soundor-debug-id="${id}"]`);
    const root = node('primitives');
    const indicator = root.locator(':scope > .sd-scroll-indicator-y');
    await expect(indicator).toBeVisible();
    const frame = (await root.boundingBox())!;
    const bar = (await indicator.boundingBox())!;
    // The root has 16px padding. Its scrollbar belongs at the border edge.
    expect(bar.y).toBeCloseTo(frame.y);
    expect(frame.x + frame.width - bar.x - bar.width).toBeCloseTo(2);
    await root.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect
      .poll(async () => {
        const end = (await indicator.boundingBox())!;
        return Math.round(end.y + end.height);
      })
      .toBe(Math.round(frame.y + frame.height));

    await node('both-custom').scrollIntoViewIfNeeded();
    // Check the painted thumb, including where grid cells pass underneath it.
    // Hit testing alone cannot catch a compositor painting content over it.
    const thumb = node('both-thumb-y');
    await page.mouse.move(0, 0);
    const png = await thumb.screenshot();
    const covered = await page.evaluate(async (base64) => {
      const bitmap = await createImageBitmap(
        await (await fetch(`data:image/png;base64,${base64}`)).blob(),
      );
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const x = Math.floor(bitmap.width / 2);
      const pixels = context.getImageData(x, 4, 1, bitmap.height - 8).data;
      let obscured = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] !== 34 || pixels[i + 1] !== 211 || pixels[i + 2] !== 238)
          obscured++;
      }
      return obscured;
    }, png.toString('base64'));
    expect(covered).toBe(0);

    // A drag stays on the bar as it passes over grid cells.
    const start = (await thumb.boundingBox())!;
    await page.mouse.move(
      start.x + start.width / 2,
      start.y + start.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      start.x + start.width / 2,
      start.y + start.height / 2 + 20,
      { steps: 4 },
    );
    await page.mouse.up();
    await expect
      .poll(() => node('both-custom').evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
  });
}
