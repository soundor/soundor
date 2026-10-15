import { originalNodes, node } from '@soundor/devtools-server/testing';
import { expect, it } from 'vitest';

import { setup, page, until } from './helpers';

it('renders actual tree, searchable roles, and base/presentation/accessibility details for an observer', async () => {
  const { page: browser, native } = await setup();
  await browser.ready();
  browser.search('adjustable');
  expect(browser.text('tree')).toContain('Gain');
  await browser.select();
  for (const value of [
    'Base styles',
    'Presentation values',
    'Accessibility',
    '96',
    'adjustable',
    '0.5',
  ])
    expect(browser.text('details')).toContain(value);
  expect(native.methods).not.toContain('UI.highlightNode');
  browser.search('missing');
  expect(browser.text('tree')).toContain('No matching nodes');
});
it('cancels native picking with browser Escape', async () => {
  const { page: browser, native } = await setup();
  await browser.ready();
  await browser.control();
  browser.click('picker');
  await until(
    () => browser.get('picker').getAttribute('aria-pressed') === 'true',
  );
  browser.win.document.dispatchEvent(
    new browser.win.KeyboardEvent('keydown', { key: 'Escape' }),
  );
  await until(
    () => browser.get('picker').getAttribute('aria-pressed') === 'false',
  );
  expect(
    native.methods.filter((method) => method === 'UI.setPickerEnabled'),
  ).toHaveLength(2);
});
it('updates sparse node metadata and details without fetching the whole hierarchy', async () => {
  const { page: browser, native } = await setup();
  await browser.ready();
  await browser.select();
  const before = native.treeRequests;
  const updated = structuredClone(originalNodes);
  updated[2]!.text = 'Volume';
  native.setNodes(updated);
  await native.event('UI.treeChanged', {
    generation: 1,
    revision: 2,
    kind: 'properties',
    nodes: [updated[2]],
  });
  await until(() => browser.text('details').includes('Volume'));
  expect(browser.text('tree')).toContain('Volume');
  expect(native.treeRequests).toBe(before);
});
it('keeps a surviving selection after a structural snapshot and invalidates removed nodes', async () => {
  const { page: browser, native } = await setup();
  await browser.ready();
  await browser.select();
  await native.event('UI.treeChanged', {
    generation: 1,
    revision: 2,
    kind: 'structure',
  });
  await until(() => native.treeRequests === 2);
  expect(
    browser.win.document
      .querySelector('[data-node-id="3"]')
      ?.getAttribute('aria-selected'),
  ).toBe('true');
  native.setNodes([node('1', null, [])]);
  await native.event('UI.treeChanged', {
    generation: 1,
    revision: 3,
    kind: 'structure',
  });
  await until(() => browser.text('details').includes('Select a node'));
});
it('reports command errors without retaining invalid details', async () => {
  const { page: browser, native } = await setup();
  await browser.ready();
  native.errors.set('UI.getNode', 'Node was removed');
  browser.search('3');
  (
    browser.win.document.querySelector(
      '[data-node-id="3"]',
    ) as unknown as HTMLElement
  ).click();
  await until(() => browser.text('notice').includes('STALE_NODE'));
  expect(browser.text('details')).toContain('Select a node');
});
it('handles a 5000-node snapshot iteratively, including search into collapsed branches', async () => {
  const { page: browser, native } = await setup();
  await browser.ready();
  native.setNodes([
    node(
      '1',
      null,
      Array.from({ length: 4999 }, (_, index) => String(index + 2)),
    ),
    ...Array.from({ length: 4999 }, (_, index) =>
      node(String(index + 2), '1', [], { text: `Item ${index}` }),
    ),
  ]);
  browser.click('refresh');
  await until(
    () => browser.win.document.querySelectorAll('.tree-row').length === 5000,
    10000,
  );
  browser.search('Item 4998');
  expect(browser.win.document.querySelectorAll('.tree-row')).toHaveLength(2);
}, 15000);
it('consumes one-use launch tickets and removes credentials from browser history', async () => {
  const { server } = await setup();
  const browser = await page(server, true);
  await browser.ready();
  expect(browser.win.location.hash).toBe('');
  expect(browser.get('auth').hidden).toBe(true);
});

it('omits unavailable performance fields for partially instrumented runtimes', async () => {
  const { page: browser, native } = await setup(true);
  await browser.ready();
  browser.click('tab-performance');
  await native.setMetrics({
    generation: 1,
    recording: false,
    elapsedMs: 100,
    frameCount: 1,
    phases: {},
    frames: [{ timestampMs: 100, productionMs: 1.25 }],
  });
  await until(() => browser.text('performance-summary').includes('1.25'));
  expect(browser.text('performance-summary')).not.toContain('Node raster');
  expect(browser.text('performance-summary')).not.toContain('CPU frame');
  expect(browser.get('performance-chart').querySelector('polyline')).toBeNull();
});

it('preserves the focused tree row while React reconciles metadata updates', async () => {
  const { page: browser, native } = await setup();
  await browser.ready();
  await browser.select();
  const row = browser.win.document.querySelector(
    '[data-node-id="3"]',
  )! as unknown as HTMLElement;
  row.focus();
  const updated = structuredClone(originalNodes);
  updated[2]!.text = 'Updated gain';
  native.setNodes(updated);
  await native.event('UI.treeChanged', {
    generation: 1,
    revision: 2,
    kind: 'properties',
    nodes: [updated[2]],
  });
  await until(() => browser.text('tree').includes('Updated gain'));
  expect(browser.win.document.querySelector('[data-node-id="3"]')).toBe(row);
  expect(browser.win.document.activeElement).toBe(row);
});

it('unmounts the React root and cancels pending work on disposal', async () => {
  const { page: browser, native } = await setup();
  await browser.ready();
  native.delayNode();
  (
    browser.win.document.querySelector(
      '[data-node-id="1"]',
    ) as unknown as HTMLElement
  ).click();
  await until(() => native.pendingRequests > 0);
  browser.dispose();
  browser.dispose();
  expect(browser.get('app').childNodes).toHaveLength(0);
  await until(() => browser.sockets.every((socket) => socket.readyState === 3));
  await until(() => native.pendingRequests === 0);
});
