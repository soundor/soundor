import { expect, type Locator, type Page, test } from '@playwright/test';

// The basic example's editor is resizable (800×600, within 480×400 and
// 1600×1200): its web host has a handle that resizes the plugin view, which
// lays the UI out again; it is not scaled. Embedded, the view is its
// iframe's size, whatever that becomes.

const PAGE = '/examples/basic/index.html';

/** The plugin viewport's size on screen. */
async function viewSize(page: Page): Promise<[number, number]> {
  const box = await page.locator('.soundor-viewport').boundingBox();
  return [Math.round(box!.width), Math.round(box!.height)];
}

async function width(locator: Locator): Promise<number> {
  return Math.round((await locator.boundingBox())!.width);
}

/** Presses the handle and moves the pointer by (dx, dy), leaving it pressed. */
async function press(page: Page, dx: number, dy: number): Promise<void> {
  const handle = page.getByRole('button', { name: 'Resize the plugin view' });
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2);
  await page.mouse.move(x + dx, y + dy);
}

async function drag(page: Page, dx: number, dy: number): Promise<void> {
  await press(page, dx, dy);
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(PAGE);
  await expect(page.getByText('Reset gain')).toBeVisible();
});

test('the view opens at the editor size and resizes, laying the UI out again', async ({
  page,
}) => {
  expect(await viewSize(page)).toEqual([800, 600]);
  const input = page.getByRole('textbox');
  const title = page
    .locator('.soundor-viewport')
    .getByText('Soundor Basic', { exact: true });
  const before = await input.boundingBox();
  const titleHeight = (await title.boundingBox())!.height;

  // The view stays centred: it grows by twice the pointer's movement.
  await drag(page, 100, 20);
  expect(await viewSize(page)).toEqual([1000, 640]);
  // Laid out again: the panel (flex: 1) took the new width; nothing scaled.
  expect(await width(input)).toBe(Math.round(before!.width) + 200);
  expect((await title.boundingBox())!.height).toBe(titleHeight);
  await expect(page.locator('.soundor-viewport')).toHaveCSS(
    'transform',
    'none',
  );

  await drag(page, -150, -60);
  expect(await viewSize(page)).toEqual([700, 520]);
  expect(await width(input)).toBe(Math.round(before!.width) - 100);
});

test('the view keeps to the editor limits and the page', async ({ page }) => {
  await drag(page, -1000, -1000);
  expect(await viewSize(page)).toEqual([480, 400]);
  // Dragged out of the window: it stops where the page has no more room
  // (the stage's padding: 16 around, 76 under it for the dock).
  await drag(page, 2000, 2000);
  expect(await viewSize(page)).toEqual([1408, 808]);
  await page.setViewportSize({ width: 2400, height: 1600 });
  await drag(page, 2000, 2000);
  expect(await viewSize(page)).toEqual([1600, 1200]);
});

test('a cancelled drag puts the size back', async ({ page }) => {
  await press(page, 100, 100);
  expect(await viewSize(page)).toEqual([1000, 800]);
  await page
    .getByRole('button', { name: 'Resize the plugin view' })
    .dispatchEvent('pointercancel', { pointerId: 1, isPrimary: true });
  await page.mouse.up();
  expect(await viewSize(page)).toEqual([800, 600]);
});

test('the handle resizes from the keyboard', async ({ page }) => {
  await page.getByRole('button', { name: 'Resize the plugin view' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  expect(await viewSize(page)).toEqual([810, 650]);
});

test('pointer input hits the UI where it is after a resize', async ({
  page,
}) => {
  await drag(page, 150, 50);
  const reset = page.getByRole('button', { name: 'Reset gain' });
  await reset.hover();
  // Hovered: the Pressable's hovered style.
  await expect(reset).toHaveCSS('background-color', 'rgb(76, 141, 255)');
  // The wheel over the fader (above its value) moves the gain.
  const value = (await page.getByText('0.50', { exact: true }).boundingBox())!;
  await page.mouse.move(value.x + value.width / 2, value.y - 100);
  await page.mouse.wheel(0, -100);
  await expect(page.getByText('0.52', { exact: true })).toBeVisible();
  await reset.click();
  await expect(page.getByText('0.50', { exact: true })).toBeVisible();
  // And the text input takes a click and typing.
  const input = page.getByRole('textbox');
  await input.click();
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await expect(input).toHaveValue(/!$/);

  // Smaller, the same.
  await drag(page, -200, -100);
  await page.mouse.move(0, 0);
  await expect(reset).not.toHaveCSS('background-color', 'rgb(76, 141, 255)');
  await reset.hover();
  await expect(reset).toHaveCSS('background-color', 'rgb(76, 141, 255)');
});

test('embedded, the view fills its iframe as the parent page resizes it', async ({
  page,
  baseURL,
}) => {
  await page.setContent(
    `<iframe src="${baseURL}${PAGE}?embed" style="border:0;width:400px;height:300px"></iframe>`,
  );
  const plugin = page.frameLocator('iframe');
  await expect(plugin.getByText('Reset gain')).toBeVisible();
  // No handle, and no editor size: the iframe's.
  await expect(
    plugin.getByRole('button', { name: 'Resize the plugin view' }),
  ).toHaveCount(0);
  const surface = plugin.locator('.sd-surface');
  const size = async () => {
    const box = (await surface.boundingBox())!;
    return [Math.round(box.width), Math.round(box.height)];
  };
  expect(await size()).toEqual([400, 300]);
  const input = plugin.getByRole('textbox');
  const before = await width(input);

  // The parent page resizes the iframe; the window stays as it was.
  await page.locator('iframe').evaluate((frame: HTMLIFrameElement) => {
    frame.style.width = '700px';
    frame.style.height = '450px';
  });
  await expect.poll(size).toEqual([700, 450]);
  expect(await width(input)).toBe(before + 300);
  expect(page.viewportSize()).toEqual({ width: 1440, height: 900 });
});
