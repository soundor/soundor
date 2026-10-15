import { methodResults } from '@soundor/devtools-protocol';
import { afterEach, expect, it } from 'vitest';

import { startDevToolsServer } from '../server';
import { startSimulatedBrowser } from './browser';
import { node as fixtureNode } from './fixtures';
import { scenarioNames, startScenario } from './scenarios';
import { startSimulatedRuntime } from './simulated-runtime';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function setup() {
  const server = await startDevToolsServer({ projectRoot: '/simulator' });
  cleanup.push(() => server.close());
  const browser = await startSimulatedBrowser(server);
  cleanup.push(() => browser.close());
  return { server, browser };
}
it('registers, polls typed commands, maintains controls and generation, and disconnects cleanly', async () => {
  const { server, browser } = await setup();
  const runtime = await startSimulatedRuntime({
    connection: server.connection,
  });
  cleanup.push(() => runtime.close());
  const tree = await browser.request('UI.getTree', runtime.id);
  expect(methodResults['UI.getTree'].parse(tree.result).nodes).toHaveLength(3);
  await browser.request('Events.subscribe', runtime.id, {
    events: ['Console.message'],
  });
  await runtime.event('Console.message', {
    level: 'info',
    message: 'Hello',
    source: 'simulator',
    timestamp: 1,
  });
  expect(browser.events).toContainEqual(
    expect.objectContaining({ event: 'Console.message' }),
  );
  expect(
    (await browser.request('Control.acquire', runtime.id)).error,
  ).toBeUndefined();
  await browser.request('UI.setPickerEnabled', runtime.id, { enabled: true });
  expect(runtime.pickerEnabled).toBe(true);
  await browser.request('UI.highlightNode', runtime.id, {
    node: { id: '3', generation: 1 },
  });
  expect(runtime.highlighted?.id).toBe('3');
  await browser.request('Diagnostics.setRecording', runtime.id, {
    enabled: true,
  });
  const metrics = await browser.request('Diagnostics.getMetrics', runtime.id);
  expect(metrics.result).toMatchObject({ recording: true });
  await runtime.event('UI.nodeSelected', { node: { id: '3', generation: 1 } });
  expect(runtime.selection).toEqual({ id: '3', generation: 1 });
  await runtime.reload();
  expect(runtime.selection).toBeNull();
  expect(runtime.generation).toBe(2);
  expect(runtime.pickerEnabled).toBe(false);
  expect(
    (
      await browser.request('UI.getNode', runtime.id, {
        node: { id: '3', generation: 1 },
      })
    ).error?.code,
  ).toBe('STALE_NODE');
  const node = await browser.request('UI.getNode', runtime.id, {
    node: { id: '3', generation: 2 },
  });
  expect(methodResults['UI.getNode'].parse(node.result).ref.generation).toBe(2);
  await runtime.close();
  await runtime.close();
  expect(runtime.failure).toBeUndefined();
  expect((await browser.request('Runtime.getTargets')).result).toEqual([]);
});
it.each(scenarioNames)(
  'provides deterministic %s scenarios through the production server',
  async (name) => {
    const { server, browser } = await setup();
    const scenario = await startScenario({
      connection: server.connection,
      server,
      scenario: name,
    });
    cleanup.push(() => scenario.close());
    const response = await browser.request('Runtime.getTargets');
    const targets = methodResults['Runtime.getTargets'].parse(response.result);
    expect(targets).toHaveLength(
      name === 'multiple-targets'
        ? 2
        : ['empty', 'disconnected'].includes(name)
          ? 0
          : 1,
    );
    const target = targets[0];
    const metrics = target
      ? await browser.request('Diagnostics.getMetrics', target.id)
      : undefined;
    expect(metrics?.error?.code).toBe(
      name === 'limited-capabilities' ? 'MISSING_CAPABILITY' : undefined,
    );
    expect(targets.map((target) => target.generation)).toEqual(
      targets.map(() => (name === 'reload' ? 2 : 1)),
    );
    const lease = target
      ? await browser.request('Control.acquire', target.id)
      : undefined;
    expect(lease?.error?.code).toBe(
      name === 'lease-conflict' ? 'LEASE_BUSY' : undefined,
    );
  },
);

it('derives roots from the current fixture tree, including empty and multiple roots', async () => {
  const { server, browser } = await setup();
  const runtime = await startSimulatedRuntime({
    connection: server.connection,
  });
  cleanup.push(() => runtime.close());
  runtime.setNodes([
    fixtureNode('custom-root', null, []),
    fixtureNode('second-root', null, []),
  ]);
  const tree = await browser.request('UI.getTree', runtime.id);
  expect(methodResults['UI.getTree'].parse(tree.result).roots).toEqual([
    'custom-root',
    'second-root',
  ]);
  runtime.setNodes([]);
  const empty = await browser.request('UI.getTree', runtime.id);
  expect(methodResults['UI.getTree'].parse(empty.result)).toMatchObject({
    roots: [],
    nodes: [],
  });
});

async function until(predicate: () => boolean): Promise<void> {
  await expect.poll(predicate).toBe(true);
}
it('cancels delayed operations without applying state changes and joins pending work on close', async () => {
  const { server, browser } = await setup();
  const runtime = await startSimulatedRuntime({
    connection: server.connection,
  });
  cleanup.push(() => runtime.close());
  await browser.request('Control.acquire', runtime.id);
  runtime.setCommandDelay('UI.setPickerEnabled', 10000);
  const abort = new AbortController();
  const result = browser.request(
    'UI.setPickerEnabled',
    runtime.id,
    { enabled: true },
    abort.signal,
  );
  await until(() => runtime.methods.includes('UI.setPickerEnabled'));
  abort.abort();
  expect((await result).error?.code).toBe('CANCELLED');
  await until(() => runtime.pendingRequests === 0);
  expect(runtime.pickerEnabled).toBe(false);
  expect(runtime.failure).toBeUndefined();
  runtime.setCommandDelay('UI.getNode', 10000);
  const pending = browser.request('UI.getNode', runtime.id, {
    node: { generation: 1, id: '3' },
  });
  await until(() => runtime.pendingRequests === 1);
  await runtime.close();
  expect((await pending).error?.code).toBe('TARGET_GONE');
  expect(runtime.pendingRequests).toBe(0);
  expect(runtime.failure).toBeUndefined();
});
it('does not apply picker, highlight or recording changes when a simulated command fails', async () => {
  const { server, browser } = await setup();
  const runtime = await startSimulatedRuntime({
    connection: server.connection,
  });
  cleanup.push(() => runtime.close());
  await browser.request('Control.acquire', runtime.id);
  runtime.errors.set('UI.setPickerEnabled', 'Picker failure');
  runtime.errors.set('UI.highlightNode', 'Highlight failure');
  runtime.errors.set('Diagnostics.setRecording', 'Recording failure');
  expect(
    (
      await browser.request('UI.setPickerEnabled', runtime.id, {
        enabled: true,
      })
    ).error?.message,
  ).toBe('Picker failure');
  expect(runtime.pickerEnabled).toBe(false);
  expect(
    (
      await browser.request('UI.highlightNode', runtime.id, {
        node: { generation: 1, id: '3' },
      })
    ).error?.message,
  ).toBe('Highlight failure');
  expect(runtime.highlighted).toBeNull();
  expect(
    (
      await browser.request('Diagnostics.setRecording', runtime.id, {
        enabled: true,
      })
    ).error?.message,
  ).toBe('Recording failure');
  expect(
    (await browser.request('Diagnostics.getMetrics', runtime.id)).result,
  ).toMatchObject({ recording: false });
  expect(runtime.failure).toBeUndefined();
});
