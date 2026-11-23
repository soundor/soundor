import { expect, test } from '@playwright/test';

test('the homepage links to the docs and the other sites', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(
    page.locator('header').getByRole('link', { name: 'Docs', exact: true }),
  ).toBeVisible();
  for (const [name, href] of [
    ['Components', 'https://components.soundor.dev/'],
    ['Icons', 'https://icons.soundor.dev/'],
  ] as const) {
    await expect(
      page.locator('header').getByRole('link', { name, exact: true }),
    ).toHaveAttribute('href', href);
  }
  expect(errors).toEqual([]);
});

test('the homepage fits a phone and its menu reaches the docs', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'in your DAW and the browser',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator('header').getByRole('button', { name: /menu/i }).click();
  await page.getByRole('link', { name: 'Docs', exact: true }).click();
  await expect(page).toHaveURL(/\/docs$/);
});
