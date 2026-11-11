import { expect, test } from '@playwright/test';

const key = 'soundor:snapshot:v1';
const databaseName = 'soundor/dev.soundor.basic';

test('persistent state and parameters survive browser reload and a new page', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/examples/basic/index.html');
  const input = page.getByRole('textbox');
  await expect(input).toHaveValue('Init');
  await input.fill('Warm Vocal');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByText('0.51', { exact: true })).toBeVisible();
  // Read real IndexedDB, rather than waiting an arbitrary debounce interval.
  await expect
    .poll(async () =>
      page.evaluate(
        async ({ databaseName, key }) => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(databaseName);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            const text = await new Promise<string | undefined>(
              (resolve, reject) => {
                const request = db
                  .transaction('storage')
                  .objectStore('storage')
                  .get(key);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              },
            );
            const snapshot = text && JSON.parse(text);
            return snapshot && Math.round(snapshot.parameters.gain * 100) === 51
              ? snapshot.state.presetName
              : undefined;
          } finally {
            db.close();
          }
        },
        { databaseName, key },
      ),
    )
    .toBe('Warm Vocal');
  await page.reload();
  await expect(page.getByRole('textbox')).toHaveValue('Warm Vocal');
  await expect(page.getByText('0.51', { exact: true })).toBeVisible();
  const next = await context.newPage();
  await next.goto('/examples/basic/index.html');
  await expect(next.getByRole('textbox')).toHaveValue('Warm Vocal');
  await next.close();
  expect(errors).toEqual([]);
});
