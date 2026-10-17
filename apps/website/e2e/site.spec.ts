import { expect, type Page, test } from '@playwright/test';

/** Fails the test on a page error, a console error or a failed request. */
function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`page: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      problems.push(`${response.status()} ${response.url()}`);
    }
  });
  return problems;
}

test('the home page leads into the docs', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Audio plugins with a React UI',
  );
  await page.getByRole('link', { name: 'Get started' }).click();
  await expect(page).toHaveURL(/\/docs\/getting-started$/);
  // A placeholder, filled in from the repository.
  await expect(
    page.getByText(/create soundor-app@\d+\.\d+\.\d+/).first(),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Parameters and host automation' })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Parameters and host automation',
  );
  expect(problems).toEqual([]);
});

test('search finds a page', async ({ page }) => {
  await page.goto('/docs');
  await page
    .getByRole('button', { name: /search/i })
    .first()
    .click();
  await page.keyboard.type('Web Audio');
  await expect(
    page.getByRole('dialog').getByText('Web runtime').first(),
  ).toBeVisible();
});

test('an example runs inside its page', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/docs/examples/basic');
  const plugin = page.frameLocator('iframe');
  await expect(plugin.getByText('Reset gain')).toBeVisible();
  await expect(plugin.getByRole('button', { name: 'Play' })).toBeVisible();
  expect(problems).toEqual([]);
});

test("an example's code can be edited, and runs when applied", async ({
  page,
}) => {
  const problems = watch(page);
  await page.goto('/docs/examples/basic');
  await page.getByRole('button', { name: 'Edit code' }).click();
  const status = page.getByRole('status');
  await expect(status).toHaveText(/^Running your code/);
  await expect(
    page.getByRole('button', { name: 'src/App.tsx' }),
  ).toHaveAttribute('aria-pressed', 'true');
  const plugin = page.frameLocator('iframe');

  // Change the button's label, found with the editor's search (it renders
  // only the lines in view), which selects it.
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+f');
  await page.keyboard.type('Reset gain');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.keyboard.type('Edited gain');
  await expect(status).toHaveText(/^Edited: apply/);
  await expect(plugin.getByText('Reset gain')).toBeVisible();
  await page.getByRole('button', { name: /^Apply/ }).click();
  await expect(plugin.getByText('Edited gain')).toBeVisible();
  await expect(status).toHaveText(/^Running your code/);
  await expect(page.getByRole('button', { name: /^Apply/ })).toBeDisabled();

  // Break it, still typing in the editor, and apply with the keyboard: the
  // error is located, and the plugin says so too.
  await page.keyboard.type(' {{');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(status).toHaveText(/^src\/App\.tsx:\d+:\d+: /);
  await expect(plugin.getByText('Your code did not run.')).toBeVisible();

  // Reset brings the example's own code back.
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(plugin.getByText('Reset gain')).toBeVisible();
  await expect(status).toHaveText(/^Running your code/);
  expect(problems).toEqual([]);
});

test("the editor knows the example's types", async ({ page }) => {
  const problems = watch(page);
  await page.goto('/docs/examples/basic');
  await page.getByRole('button', { name: 'Edit code' }).click();
  await expect(page.getByRole('status')).toHaveText(/^Running your code/);

  // Completions from the `soundor:parameters` the example's config declares.
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\nparameters.');
  await expect(page.getByRole('option', { name: 'gain' })).toBeVisible();
  // The list takes Enter only once it has been open a moment (75 ms), so
  // that an Enter typed as it opens stays a new line.
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');
  await page.keyboard.type(';');
  await expect(page.locator('.cm-activeLine')).toHaveText('parameters.gain;');

  // The errors tsc would report, in place.
  await page.keyboard.type('\nconst label: string = 1;');
  await expect(page.locator('.cm-lintRange-error')).toHaveCount(1);

  // And the types under the pointer (in view: the editor renders no more).
  await page
    .locator('.cm-activeLine')
    .getByText('label', { exact: true })
    .hover();
  await expect(page.locator('.cm-ts-info')).toHaveText('const label: string');
  expect(problems).toEqual([]);
});

test('an example opens full screen, its editor beside it', async ({ page }) => {
  await page.goto('/docs/examples/basic');
  await page.getByRole('button', { name: 'Full screen' }).click();
  const figure = page.locator('figure', { has: page.locator('iframe') });
  await expect(page.locator('.cm-content')).toBeVisible();
  const viewport = page.viewportSize();
  await expect
    .poll(async () => (await figure.boundingBox())?.height)
    .toBe(viewport?.height);
  const plugin = page.frameLocator('iframe');
  await expect(plugin.getByText('Reset gain')).toBeVisible();

  await page.getByRole('button', { name: 'Exit full screen' }).click();
  await expect(page.getByRole('button', { name: 'Full screen' })).toBeVisible();
  await expect(page.locator('.cm-content')).toBeVisible();
});

test('a snippet runs in its page, with its code under it', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/docs/react');
  const snippet = page.locator('figure', {
    has: page.locator('iframe[title*="gain snippet"]'),
  });
  const plugin = snippet.frameLocator('iframe');
  await expect(plugin.getByText('Gain 0.50')).toBeVisible();
  // The embed: the plugin view alone, no host controls.
  await expect(plugin.getByRole('toolbar', { name: 'Host' })).toHaveCount(0);
  await expect(snippet.locator('pre')).toContainText(
    'export default function Gain()',
  );
  // The code scrolls in one box, not in a box in a box.
  const scrolling = await snippet.evaluate(
    (figure) =>
      [...figure.querySelectorAll('*')].filter(
        (element) =>
          /auto|scroll/.test(getComputedStyle(element).overflowY) &&
          element.scrollHeight > element.clientHeight,
      ).length,
  );
  expect(scrolling).toBe(1);

  await plugin.getByRole('button', { name: '+' }).click();
  await expect(plugin.getByText('Gain 0.60')).toBeVisible();

  // Edited, it shows only the snippet, and runs the change.
  await snippet.getByRole('button', { name: 'Edit code' }).click();
  await expect(snippet.getByRole('button', { name: /^src\// })).toHaveText([
    'src/snippets/gain.tsx',
  ]);
  await snippet.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+f');
  await page.keyboard.type('Gain {');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.keyboard.type('Level {');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(plugin.getByText('Level 0.60')).toBeVisible();

  await snippet.getByRole('button', { name: 'Replay' }).click();
  await expect(plugin.getByText('Level 0.60')).toBeVisible();
  expect(problems).toEqual([]);
});

test("a page's Markdown has its snippets' code", async ({ request }) => {
  const markdown = await (await request.get('/docs/react.md')).text();
  expect(markdown).toContain('export default function Gain()');
  expect(markdown).not.toContain('<Snippet');
});

test("a component's page runs it, and lists its props from its types", async ({
  page,
}) => {
  const problems = watch(page);
  await page.goto('/docs/components/pressable');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pressable');
  const plugin = page.frameLocator('iframe[title*="pressable snippet"]');
  await expect(plugin.getByRole('button', { name: /Press me/ })).toBeVisible();
  // Its own props, with their doc comments; inherited ones are elsewhere.
  const props = page.locator('#props ~ div').first();
  await expect(props).toContainText('delayLongPress');
  await expect(props).not.toContainText('onPointerDown');
  await page.getByRole('button', { name: /delayLongPress/ }).click();
  await expect(
    page.getByText('Milliseconds before a press is a long press'),
  ).toBeVisible();
  expect(problems).toEqual([]);
});

test('the tabs lead to Components and API', async ({ page }) => {
  await page.goto('/docs');
  await page.getByRole('button', { name: /^Docs/ }).first().click();
  await page.getByRole('link', { name: /^API/ }).click();
  await expect(page).toHaveURL(/\/docs\/api$/);
  await page.getByRole('link', { name: 'soundor:fs' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'soundor:fs',
  );
});

test("a component's Markdown has its props table", async ({ request }) => {
  const markdown = await (
    await request.get('/docs/components/pressable.md')
  ).text();
  expect(markdown).toMatch(
    /\| `delayLongPress\?` +\| `number` +\| Milliseconds/,
  );
  expect(markdown).not.toContain('<auto-type-table');
});
