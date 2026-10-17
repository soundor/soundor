import { expect, test } from '@playwright/test';

test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });

test('the homepage demo plays and expands without opening an editor', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const frame = page.frameLocator(
    'iframe[title="Orbit — playable stereo delay"]',
  );
  await expect(
    frame.getByRole('button', { name: 'Play', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit code' })).toHaveCount(0);
  await frame.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(
    frame.getByRole('button', { name: 'Pause', exact: true }),
  ).toBeVisible();
  await frame.getByRole('radio', { name: 'Original', exact: true }).click();
  await expect(
    frame.getByText('Bypassed · original audio', { exact: true }),
  ).toBeVisible();
  const mix = frame.getByRole('slider', { name: 'Mix', exact: true });
  await mix.focus();
  await page.keyboard.press('ArrowUp');
  await expect(mix).toHaveAttribute('aria-valuenow', '0.61');

  await page.getByRole('button', { name: 'Full screen', exact: true }).click();
  const figure = page.getByRole('figure', {
    name: 'Try Orbit, a stereo delay built with Soundor',
  });
  await expect
    .poll(async () => (await figure.boundingBox())?.height)
    .toBe(page.viewportSize()?.height);
  await expect(page.locator('.cm-content')).toHaveCount(0);
  await expect(mix).toHaveAttribute('aria-valuenow', '0.61');
  await page
    .getByRole('button', { name: 'Exit full screen', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Full screen', exact: true }),
  ).toBeVisible();
  await frame.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(
    page.locator('header').getByRole('link', { name: 'Docs', exact: true }),
  ).toBeVisible();
  await page
    .locator('header')
    .getByRole('link', { name: 'Components', exact: true })
    .click();
  await expect(page).toHaveURL(/\/docs\/components$/);
  expect(errors).toEqual([]);
});

test('the homepage fits a phone and its menu reaches the docs', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Your sound. Your interface.',
  );
  await expect(
    page
      .frameLocator('iframe')
      .getByRole('button', { name: 'Play', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator('header').getByRole('button', { name: /menu/i }).click();
  await page.getByRole('link', { name: 'Docs', exact: true }).click();
  await expect(page).toHaveURL(/\/docs$/);
});
