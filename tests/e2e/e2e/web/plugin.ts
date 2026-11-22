import { expect, type Page } from '@playwright/test';

/** Opens the web build, once its view is up. */
export async function openPlugin(page: Page): Promise<void> {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Soundor E2E', exact: true }),
  ).toBeVisible();
}

/** A node by its `debugId`, as the engine's DOM adapter marks it. */
export const byDebugId = (page: Page, id: string) =>
  page.locator(`[data-soundor-debug-id="${id}"]`);

/** Collects the page's errors, to expect none at the end. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}
