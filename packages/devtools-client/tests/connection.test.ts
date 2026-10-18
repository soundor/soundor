import { expect, it } from 'vitest';

import { setup, page, target, until } from './helpers';

it('lets two tabs highlight and pick side by side, each its own', async () => {
  const { server, page: first, native } = await setup();
  await first.ready();
  const second = await page(server);
  await second.ready();
  await first.select();
  await second.select('1');
  // Each tab's highlight is drawn: neither replaces the other's.
  await until(() => native.highlights.length === 2);
  first.click('picker');
  await until(
    () => first.get('picker').getAttribute('aria-pressed') === 'true',
  );
  expect(second.get('picker').getAttribute('aria-pressed')).toBe('false');
  first.search('does not match');
  await native.event('UI.nodeSelected', { node: { id: '3', generation: 1 } });
  await until(
    () =>
      first.win.document
        .querySelector('[data-node-id="3"]')
        ?.getAttribute('aria-selected') === 'true',
  );
  expect((first.get('search') as unknown as HTMLInputElement).value).toBe('');
  expect(first.get('picker').getAttribute('aria-pressed')).toBe('false');
  expect(first.text('details')).toContain('Gain');
  // The pick was the first tab's alone.
  expect(
    second.win.document
      .querySelector('[data-node-id="1"]')
      ?.getAttribute('aria-selected'),
  ).toBe('true');
});
it('invalidates node selection on reload and ignores late old-generation details', async () => {
  const { page: browser, native } = await setup();
  await browser.ready();
  native.delayNode();
  browser.search('3');
  (
    browser.win.document.querySelector(
      '[data-node-id="3"]',
    ) as unknown as HTMLElement
  ).click();
  await until(() => native.methods.includes('UI.getNode'));
  await native.reload();
  await until(() => browser.text('target-meta').includes('generation 2'));
  await until(() => native.treeRequests >= 2);
  expect(browser.text('details')).toContain('Select a node');
  expect(
    browser.win.document.querySelector('[aria-selected="true"]'),
  ).toBeNull();
});
it('cleans subscriptions and its highlight when switching targets', async () => {
  const { server, page: browser, native } = await setup();
  const second = await target(server, 'Other Plugin');
  await browser.ready();
  await browser.select();
  await until(() => native.highlights.length === 1);
  await until(() =>
    browser.get('targets').textContent.includes('Other Plugin'),
  );
  (browser.get('targets') as unknown as HTMLSelectElement).value = second.id;
  browser
    .get('targets')
    .dispatchEvent(new browser.win.Event('change', { bubbles: true }));
  await until(() => browser.text('details').includes('Select a node'));
  await until(() => native.highlights.length === 0);
  await until(() =>
    native.commands.some(
      (command) => command.type === 'subscribe' && command.events.length === 0,
    ),
  );
});
it('clears misleading data when a target disconnects', async () => {
  const { page: browser, native } = await setup();
  await browser.ready();
  await browser.select();
  await native.disconnect();
  await until(() => browser.text('tree').includes('disconnected'));
  expect(browser.text('details')).toContain('Select a node');
  expect(browser.get('picker').hasAttribute('disabled')).toBe(true);
});
it('reconnects the socket as a new client, its old state dropped', async () => {
  const { page: browser, native } = await setup();
  await browser.ready();
  await browser.select();
  await until(() => native.highlights.length === 1);
  browser.sockets[0]!.terminate();
  await until(() => browser.text('status').includes('Disconnected'));
  await until(
    () =>
      browser.sockets.length === 2 &&
      browser.text('status').includes('Connected'),
  );
  await browser.ready();
  await until(() => native.highlights.length === 0);
  expect(browser.get('picker').hasAttribute('disabled')).toBe(false);
});
it('displays mapped session logs safely, filters severity/text, and clears only this view', async () => {
  const { server, native, page: browser } = await setup();
  await browser.ready();
  await native.event('Console.message', {
    level: 'warn',
    message: 'Native diagnostic',
    source: 'engine',
    timestamp: Date.now(),
  });
  await until(() => browser.text('logs').includes('Native diagnostic'));
  expect(browser.text('logs')).toContain('selected target');
  server.publishLog({
    level: 'error',
    message: '<script>bad()</script>\n  at src/main.tsx:12:3',
    source: 'application',
  });
  server.publishLog({ level: 'info', message: 'Hello', source: 'application' });
  await until(() => browser.text('logs').includes('Hello'));
  expect(browser.text('logs')).toContain('src/main.tsx:12:3');
  expect(browser.text('logs')).toContain('development session');
  expect(browser.get('logs').querySelector('script')).toBeNull();
  (browser.get('log-level') as unknown as HTMLSelectElement).value = 'error';
  browser
    .get('log-level')
    .dispatchEvent(new browser.win.Event('change', { bubbles: true }));
  expect(browser.text('logs')).not.toContain('Hello');
  browser.click('clear-logs');
  expect(browser.text('logs')).toBe('');
});
