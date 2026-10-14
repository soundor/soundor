import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  DebugNode,
  DebugAnimation,
  DebugMetrics,
  DebugTree,
  RuntimeCommand,
} from '@soundor/devtools-protocol';
import { Window as TestWindow, HTMLElement as TestElement } from 'happy-dom';
import { afterEach, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { dashboard } from './dashboard';
import { startInspector } from './dashboard-client.js';
import { startDevToolsServer, type DevToolsServer } from './server';

const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function until(predicate: () => boolean, timeout = 4000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(predicate()).toBe(true);
}
function node(
  id: string,
  parent: string | null,
  children: string[],
  extra: Partial<DebugNode> = {},
): DebugNode {
  return {
    ref: { generation: 1, id },
    type: 'View',
    parent,
    children,
    bounds: { x: 12, y: 24, width: 96, height: 96 },
    focused: false,
    visible: true,
    ...extra,
  };
}
const originalNodes = [
  node('1', null, ['2']),
  node('2', '1', ['3']),
  node('3', '2', [], {
    type: 'Text',
    text: 'Gain',
    debugId: 'gain',
    styles: { opacity: 1 },
    presentation: { opacity: 0.5 },
    accessibility: { role: 'adjustable', name: 'Gain', value: 0.5 },
    layout: { scale: 1 },
  }),
];
async function setup(diagnostics = false) {
  const root = await mkdtemp(join(tmpdir(), 'soundor-inspector-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const server = await startDevToolsServer({
    projectRoot: root,
    settings: { enabled: true, port: 0, open: false, portSource: 'config' },
  });
  cleanup.push(() => server.close());
  const native = await target(server, 'Gain Plugin', diagnostics);
  return { server, native, page: await page(server) };
}
async function target(
  server: DevToolsServer,
  name = 'Gain Plugin',
  diagnostics = false,
) {
  const headers = {
    Authorization: `Bearer ${server.connection.token}`,
    'X-Soundor-Session': server.connection.sessionId,
    'Content-Type': 'application/json',
  };
  const register = await fetch(
    server.connection.endpoint + '/runtime/register',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        version: 1,
        sessionId: server.connection.sessionId,
        generation: 1,
        name,
        runtime: 'Fake Native',
        capabilities: diagnostics
          ? ['inspector', 'accessibility', 'animations', 'performance']
          : ['inspector', 'accessibility'],
      }),
    },
  );
  const registration = (await register.json()) as {
    targetId: string;
    targetToken: string;
  };
  const targetHeaders = {
    ...headers,
    'X-Soundor-Target': registration.targetId,
    'X-Soundor-Target-Token': registration.targetToken,
  };
  let alive = true;
  let generation = 1;
  let treeNodes = structuredClone(originalNodes);
  const methods: string[] = [];
  const commands: RuntimeCommand[] = [];
  const errors = new Map<string, string>();
  let treeRequests = 0;
  let delayedNode = false;
  let metrics: DebugMetrics = {
    generation: 1,
    recording: false,
    elapsedMs: 0,
    frameCount: 0,
    delayedTicks: 0,
    tickIntervalMs: 0,
    phases: {},
    frames: [],
  };
  let animations: DebugAnimation[] = [
    {
      id: '1',
      playbackGeneration: 0,
      state: 'running',
      kind: 'timing',
      elapsedMs: 50,
      durationMs: 100,
      durationScope: 'iteration',
      delayMs: 0,
      iterations: 1,
      easing: 'linear',
      targets: [
        {
          node: { generation: 1, id: '3' },
          properties: ['opacity'],
          presentation: { opacity: 0.5 },
        },
      ],
      targetsTruncated: false,
    },
  ];
  const post = (message: unknown) =>
    fetch(server.connection.endpoint + '/runtime/messages', {
      method: 'POST',
      headers: targetHeaders,
      body: JSON.stringify(message),
    });
  const poller = (async () => {
    while (alive) {
      try {
        const response = await fetch(
          server.connection.endpoint + '/runtime/poll',
          { headers: targetHeaders },
        );
        if (!response.ok) break;
        const batch = (await response.json()) as { commands: RuntimeCommand[] };
        for (const command of batch.commands) {
          commands.push(command);
          if (command.type === 'resetControl') {
            metrics = {
              ...metrics,
              generation,
              recording: false,
              frameCount: 0,
              frames: [],
              phases: {},
            };
            if (diagnostics)
              await post({
                type: 'event',
                event: 'Diagnostics.metrics',
                data: metrics,
              });
          }
          if (command.type !== 'request') continue;
          methods.push(command.method);
          let result: unknown = null;
          let error = errors.get(command.method);
          if (command.method === 'Diagnostics.getMetrics') result = metrics;
          if (command.method === 'Diagnostics.setRecording') {
            metrics = {
              ...metrics,
              recording: (command.params as { enabled: boolean }).enabled,
            };
            await post({
              type: 'event',
              event: 'Diagnostics.metrics',
              data: metrics,
            });
          }
          if (command.method === 'Animation.getActive') {
            const filter = (command.params as { node?: { id: string } }).node;
            result = animations.filter(
              (animation) =>
                !filter ||
                animation.targets.some(
                  (target) => target.node.id === filter.id,
                ),
            );
          }
          if (command.method === 'UI.getTree') {
            ++treeRequests;
            result = {
              generation,
              revision: treeRequests,
              roots: ['1'],
              nodes: treeNodes,
              truncated: false,
            } satisfies DebugTree;
          }
          if (command.method === 'UI.getNode') {
            const ref = (command.params as { node: { id: string } }).node;
            result = treeNodes.find((item) => item.ref.id === ref.id);
            if (!result) error = 'Node was removed';
            if (delayedNode)
              await new Promise((resolve) => setTimeout(resolve, 180));
          }
          if (command.method === 'UI.setPickerEnabled')
            await post({
              type: 'event',
              event: 'UI.pickerChanged',
              data: command.params,
            });
          await post({
            type: 'response',
            id: command.id,
            ...(error
              ? { error: { code: 'STALE_NODE', message: error } }
              : { result }),
          });
        }
      } catch {
        break;
      }
    }
  })();
  cleanup.push(async () => {
    alive = false;
    await server.close();
    await poller;
  });
  return {
    id: registration.targetId,
    methods,
    commands,
    errors,
    get treeRequests() {
      return treeRequests;
    },
    delayNode() {
      delayedNode = true;
    },
    setNodes(value: DebugNode[]) {
      treeNodes = value;
    },
    setAnimations(value: DebugAnimation[]) {
      animations = value;
    },
    async setMetrics(value: DebugMetrics) {
      metrics = value;
      await post({
        type: 'event',
        event: 'Diagnostics.metrics',
        data: metrics,
      });
    },
    async event(event: string, data: unknown) {
      await post({ type: 'event', event, data });
    },
    async reload() {
      ++generation;
      treeNodes = treeNodes.map((item) => ({
        ...item,
        ref: { ...item.ref, generation },
      }));
      await post({
        type: 'event',
        event: 'Runtime.generationChanged',
        data: { generation },
      });
    },
    async disconnect() {
      alive = false;
      await fetch(server.connection.endpoint + '/runtime/disconnect', {
        method: 'POST',
        headers: targetHeaders,
      });
    },
  };
}
async function page(server: DevToolsServer, ticket = false) {
  const win = new TestWindow({
    url: ticket ? server.browserLaunchUrl() : server.url,
    settings: {
      disableJavaScriptFileLoading: true,
      disableJavaScriptEvaluation: true,
    },
  });
  win.document.write(dashboard);
  let cookie = '';
  Object.defineProperty(win, 'fetch', {
    value: async (url: string, init: RequestInit = {}) => {
      const response = await fetch(new URL(url, server.url), {
        ...init,
        headers: { ...init.headers, Origin: server.url, Cookie: cookie },
      });
      const value = response.headers.get('set-cookie');
      if (value) cookie = value.split(';')[0]!;
      return response;
    },
  });
  const sockets: WebSocket[] = [];
  class BrowserSocket extends WebSocket {
    constructor(url: string) {
      super(url, { origin: server.url, headers: { Cookie: cookie } });
      sockets.push(this);
    }
  }
  Object.defineProperty(win, 'WebSocket', { value: BrowserSocket });
  const dispose = startInspector(win as unknown as Window & typeof globalThis);
  cleanup.push(async () => {
    dispose();
    await win.happyDOM.abort();
    win.close();
  });
  const get = (id: string) =>
    win.document.getElementById(id)! as unknown as TestElement;
  const click = (id: string) =>
    (get(id) as unknown as HTMLButtonElement).click();
  const text = (id: string) => get(id).textContent;
  const search = (query: string) => {
    (get('search') as unknown as HTMLInputElement).value = query;
    get('search').dispatchEvent(new win.Event('input'));
  };
  if (!ticket) {
    await until(() => !get('auth').hidden);
    const { browserKey } = JSON.parse(
      await readFile(server.descriptorPath, 'utf8'),
    );
    (get('key') as unknown as HTMLInputElement).value = browserKey;
    get('auth').dispatchEvent(new win.Event('submit', { cancelable: true }));
  }
  await until(() => text('status').includes('Connected'));
  return {
    win,
    get,
    click,
    text,
    search,
    dispose,
    sockets,
    async ready() {
      await until(() => !!win.document.querySelector('[data-node-id="1"]'));
    },
    async select(id = '3') {
      search(id);
      await until(() => !!win.document.querySelector(`[data-node-id="${id}"]`));
      (
        win.document.querySelector(
          `[data-node-id="${id}"]`,
        ) as unknown as HTMLElement
      ).click();
      await until(() => text('details').includes(` / ${id}`));
    },
    async control() {
      click('control');
      await until(() => text('ownership').includes('You control'));
    },
  };
}

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
it('allows only the lease owner to highlight and pick across two tabs', async () => {
  const { server, page: controller, native } = await setup();
  await controller.ready();
  const observer = await page(server);
  await observer.ready();
  await controller.control();
  await observer.select('1');
  observer.click('control');
  await until(() => observer.text('notice').includes('LEASE_BUSY'));
  expect(observer.get('picker').hasAttribute('disabled')).toBe(true);
  await controller.select();
  await until(() => native.methods.includes('UI.highlightNode'));
  controller.click('picker');
  await until(
    () => controller.get('picker').getAttribute('aria-pressed') === 'true',
  );
  controller.search('does not match');
  await native.event('UI.nodeSelected', { node: { id: '3', generation: 1 } });
  await until(
    () =>
      controller.win.document
        .querySelector('[data-node-id="3"]')
        ?.getAttribute('aria-selected') === 'true',
  );
  expect((controller.get('search') as unknown as HTMLInputElement).value).toBe(
    '',
  );
  expect(controller.get('picker').getAttribute('aria-pressed')).toBe('false');
  expect(controller.text('details')).toContain('Gain');
  expect(
    observer.win.document
      .querySelector('[data-node-id="1"]')
      ?.getAttribute('aria-selected'),
  ).toBe('true');
  controller.click('control');
  await until(() => observer.text('ownership').includes('available'));
  await observer.control();
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
it('cleans subscriptions and releases control when switching targets', async () => {
  const { server, page: browser, native } = await setup();
  const second = await target(server, 'Other Plugin');
  await browser.ready();
  await browser.control();
  await browser.select();
  await until(() =>
    browser.get('targets').textContent.includes('Other Plugin'),
  );
  (browser.get('targets') as unknown as HTMLSelectElement).value = second.id;
  browser.get('targets').dispatchEvent(new browser.win.Event('change'));
  await until(() => browser.text('details').includes('Select a node'));
  await until(() =>
    native.commands.some((command) => command.type === 'resetControl'),
  );
  await until(() =>
    native.commands.some(
      (command) => command.type === 'subscribe' && command.events.length === 0,
    ),
  );
  expect(browser.text('ownership')).toContain('available');
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
it('reconnects the socket without silently reacquiring control', async () => {
  const { page: browser } = await setup();
  await browser.ready();
  await browser.control();
  browser.sockets[0]!.terminate();
  await until(() => browser.text('status').includes('Disconnected'));
  await until(
    () =>
      browser.sockets.length === 2 &&
      browser.text('status').includes('Connected'),
  );
  await browser.ready();
  expect(browser.text('ownership')).toContain('available');
  expect(browser.get('picker').hasAttribute('disabled')).toBe(true);
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
  browser.get('log-level').dispatchEvent(new browser.win.Event('change'));
  expect(browser.text('logs')).not.toContain('Hello');
  browser.click('clear-logs');
  expect(browser.text('logs')).toBe('');
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
it('serves the shipped browser module and a restrictive dashboard policy', async () => {
  const { server } = await setup();
  const response = await fetch(server.url);
  expect(response.headers.get('content-security-policy')).toContain(
    "frame-ancestors 'none'",
  );
  const script = await fetch(server.url + '/dashboard.js');
  expect(script.headers.get('content-type')).toBe('text/javascript');
  expect(await script.text()).toContain('startInspector');
});

it('shows native animation targets and lifecycle events, and clears them on reload', async () => {
  const { page: browser, native } = await setup(true);
  await browser.ready();
  browser.click('tab-animations');
  await until(() => browser.text('animations').includes('opacity'));
  expect(browser.text('animations')).toContain('50.0 ms');
  await browser.select();
  await until(() => browser.text('details').includes('Animations'));
  native.setAnimations([]);
  await native.event('Animation.changed', {
    generation: 1,
    changes: [
      {
        id: '1',
        node: { generation: 1, id: '3' },
        playbackGeneration: 0,
        state: 'cancelled',
      },
    ],
    truncated: false,
  });
  await until(() => browser.text('animations').includes('cancelled'));
  await native.reload();
  await until(() => browser.text('target-meta').includes('generation 2'));
  expect(browser.text('animations')).not.toContain('cancelled');
});
it('records diagnostics only with control and shares measured samples with observers', async () => {
  const { server, page: controller, native } = await setup(true);
  await controller.ready();
  const observer = await page(server);
  await observer.ready();
  observer.click('tab-performance');
  expect(observer.get('record-performance').hasAttribute('disabled')).toBe(
    true,
  );
  await controller.control();
  controller.click('tab-performance');
  controller.click('record-performance');
  await until(
    () =>
      controller.text('performance-status') === 'Recording · 10 Hz samples' &&
      !controller.get('record-performance').hasAttribute('disabled'),
  );
  const sample: DebugMetrics = {
    generation: 1,
    recording: true,
    elapsedMs: 100,
    frameCount: 6,
    delayedTicks: 0,
    tickIntervalMs: 16.5,
    phases: { webMs: 0.1, ticks: 6 },
    frames: [
      {
        timestampMs: 100,
        frameMs: 4,
        productionMs: 3,
        compositionMs: 1,
        rasterMs: 2,
        layoutMs: 0.5,
        mode: 'cpu',
        backend: 'Skia raster',
        layerCount: 2,
        layersRasterized: 1,
        pixelsRasterized: 100,
        gpuLayers: 0,
        gpuReadbacks: 0,
        cachedRasterBytes: 400,
        layersComposited: 2,
        pixelsComposited: 100,
        bytesUploaded: 0,
        textureAllocations: 0,
        drawCalls: 0,
        compositorReadbacks: 0,
      },
    ],
  };
  await native.setMetrics(sample);
  await until(() =>
    observer.text('performance-summary').includes('Skia raster'),
  );
  expect(
    controller.get('performance-chart').querySelector('polyline'),
  ).not.toBeNull();
  controller.click('record-performance');
  await until(
    () => controller.text('record-performance') === 'Start recording',
  );
  expect(controller.text('performance-summary')).toContain('4.00');
  controller.click('control');
  await until(() => observer.text('ownership').includes('available'));
  await until(
    () => !observer.text('performance-summary').includes('Skia raster'),
  );
});
it('reports unsupported diagnostics and never enables a recording for an observer', async () => {
  const { page: browser, native } = await setup();
  await browser.ready();
  browser.click('tab-performance');
  expect(browser.text('performance-status')).toContain('does not support');
  browser.click('record-performance');
  expect(native.methods).not.toContain('Diagnostics.setRecording');
  browser.click('tab-animations');
  expect(browser.text('animations')).toContain('does not support');
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
