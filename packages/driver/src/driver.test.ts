import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  startDevToolsServer,
  type DevToolsServer,
} from '@soundor/devtools-server';
import {
  node,
  originalNodes,
  startSimulatedBrowser,
  startSimulatedRuntime,
} from '@soundor/devtools-server/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { connect, type Driver } from './driver';
import { isDriverError, type DriverErrorCode } from './errors';

type Runtime = Awaited<ReturnType<typeof startSimulatedRuntime>>;

let root: string;
let server: DevToolsServer;
let runtimes: Runtime[];
let drivers: Driver[];
let browserKey: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'soundor-driver-'));
  server = await startDevToolsServer({ projectRoot: root, port: 0 });
  browserKey = (
    JSON.parse(await readFile(server.descriptorPath, 'utf8')) as {
      browserKey: string;
    }
  ).browserKey;
  runtimes = [];
  drivers = [];
});

afterEach(async () => {
  await Promise.all(drivers.map((driver) => driver.disconnect()));
  await Promise.all(runtimes.map((runtime) => runtime.close()));
  await server.close();
  await rm(root, { recursive: true, force: true });
});

async function runtime(name?: string): Promise<Runtime> {
  const started = await startSimulatedRuntime({
    connection: server.connection,
    ...(name ? { name } : {}),
  });
  runtimes.push(started);
  return started;
}

async function driver(options: Parameters<typeof connect>[0] = {}) {
  const connected = await connect({
    descriptorPath: server.descriptorPath,
    ...options,
  });
  drivers.push(connected);
  return connected;
}

async function failure(
  promise: Promise<unknown>,
  code: DriverErrorCode,
): Promise<Error> {
  const error = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!isDriverError(error))
    throw new Error(`Expected a DriverError ${code}, got ${String(error)}`);
  expect(error.code).toBe(code);
  return error;
}

async function until(predicate: () => boolean, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Condition not reached');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('connecting', () => {
  it('signs in with the protected descriptor and lists targets', async () => {
    const plugin = await runtime();
    const connected = await driver();
    expect(connected.project).toBe(root);
    expect(await connected.targets()).toEqual([
      expect.objectContaining({
        id: plugin.id,
        name: 'Gain Plugin',
        generation: 1,
      }),
    ]);
  });

  it('signs in with an explicit endpoint and browser key', async () => {
    await runtime();
    const connected = await driver({
      descriptorPath: undefined,
      endpoint: server.connection.endpoint,
      browserKey,
    });
    expect((await connected.getTree()).nodes).toHaveLength(3);
  });

  it('reads the descriptor path and browser key from the environment', async () => {
    await runtime();
    process.env['SOUNDOR_DEVTOOLS_SESSION'] = server.descriptorPath;
    try {
      const connected = await connect();
      drivers.push(connected);
      expect((await connected.target()).name).toBe('Gain Plugin');
    } finally {
      delete process.env['SOUNDOR_DEVTOOLS_SESSION'];
    }
    process.env['SOUNDOR_DEVTOOLS_BROWSER_KEY'] = browserKey;
    try {
      const connected = await connect({ endpoint: server.connection.endpoint });
      drivers.push(connected);
      expect(connected.connected).toBe(true);
    } finally {
      delete process.env['SOUNDOR_DEVTOOLS_BROWSER_KEY'];
    }
  });

  it('rejects a wrong browser key without revealing keys', async () => {
    const wrong = 'f'.repeat(64);
    const error = await failure(
      connect({ endpoint: server.connection.endpoint, browserKey: wrong }),
      'AUTHENTICATION_FAILED',
    );
    expect(error.message).not.toContain(wrong);
    expect(error.message).not.toContain(browserKey);
    expect(error.message).not.toContain(server.connection.token);
  });

  it('never authenticates with the native runtime token', async () => {
    await expect(
      connect({
        endpoint: server.connection.endpoint,
        browserKey: server.connection.token,
      }),
    ).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    });
  });

  it('reports a server that is not running', async () => {
    const endpoint = server.connection.endpoint;
    await server.close();
    await expect(connect({ endpoint, browserKey })).rejects.toMatchObject({
      code: 'SERVER_UNAVAILABLE',
    });
  });

  it('requires a session and validates options', async () => {
    await expect(connect({})).rejects.toMatchObject({
      code: 'INVALID_OPTIONS',
    });
    await expect(
      connect({ endpoint: 'http://10.0.0.1:4545', browserKey }),
    ).rejects.toMatchObject({
      code: 'INVALID_OPTIONS',
    });
    await expect(
      connect({ descriptorPath: server.descriptorPath, timeout: 0 }),
    ).rejects.toMatchObject({
      code: 'INVALID_OPTIONS',
    });
    await expect(
      connect({
        descriptorPath: server.descriptorPath,
        targetId: 'a',
        targetName: 'b',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_OPTIONS',
    });
  });

  it('can be cancelled while connecting', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      connect({
        descriptorPath: server.descriptorPath,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({
      code: 'CANCELLED',
    });
  });

  it('disconnects idempotently and fails pending and later calls', async () => {
    const plugin = await runtime();
    plugin.setCommandDelay('UI.getTree', 1000);
    const connected = await driver();
    const pending = failure(connected.getTree(), 'DISCONNECTED');
    await until(() => plugin.pendingRequests > 0);
    await connected.disconnect();
    await connected.disconnect();
    expect(connected.connected).toBe(false);
    await pending;
    await expect(connected.targets()).rejects.toMatchObject({
      code: 'DISCONNECTED',
    });
    // The server dropped the client and told the runtime to drop the work.
    await until(() =>
      plugin.commands.some((command) => command.type === 'cancel'),
    );
  });
});

describe('targets', () => {
  it('reports when no instance is running, and waits for one', async () => {
    const connected = await driver();
    expect(await connected.targets()).toEqual([]);
    await expect(connected.getTree()).rejects.toMatchObject({
      code: 'NO_TARGETS',
    });
    const waiting = connected.waitForTarget({ timeout: 3000 });
    const plugin = await runtime();
    expect((await waiting).id).toBe(plugin.id);
    expect((await connected.getTree()).generation).toBe(1);
  });

  it('times out waiting for an instance', async () => {
    const connected = await driver();
    await expect(
      connected.waitForTarget({ timeout: 50 }),
    ).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('requires a selection among several instances', async () => {
    await runtime();
    const second = await runtime('Second Gain Plugin');
    const ambiguous = await driver();
    const error = await failure(ambiguous.getTree(), 'AMBIGUOUS_TARGET');
    expect(error.message).toContain('Second Gain Plugin');
    const byId = await driver({ targetId: second.id });
    expect((await byId.target()).id).toBe(second.id);
    const byName = await driver({ targetName: 'Second Gain Plugin' });
    expect((await byName.target()).id).toBe(second.id);
  });

  it('fails fast on an unknown or duplicate target selection', async () => {
    await runtime();
    await runtime();
    await expect(driver({ targetId: 'missing' })).rejects.toMatchObject({
      code: 'TARGET_NOT_FOUND',
    });
    await expect(driver({ targetName: 'Gain Plugin' })).rejects.toMatchObject({
      code: 'AMBIGUOUS_TARGET',
    });
  });

  it('never moves to another instance after its target disconnects', async () => {
    const first = await runtime();
    const connected = await driver({ targetId: first.id });
    await connected.getTree();
    await first.close();
    // Same name, new instance: not the same target.
    await runtime();
    await expect(connected.getTree()).rejects.toMatchObject({
      code: 'TARGET_DISCONNECTED',
    });
    await expect(connected.target()).rejects.toMatchObject({
      code: 'TARGET_DISCONNECTED',
    });
  });
});

describe('inspection', () => {
  it('reads the tree, node details and property groups beside another client', async () => {
    const plugin = await runtime();
    const browser = await startSimulatedBrowser(server);
    try {
      await browser.request('UI.highlightNode', plugin.id, {
        node: { generation: 1, id: '3' },
      });
      const connected = await driver();
      const tree = await connected.getTree();
      expect(tree.roots).toEqual(['1']);
      const gain = tree.nodes.find((item) => item.debugId === 'gain')!;
      const details = await connected.getNode(gain.ref);
      expect(details.accessibility).toMatchObject({ name: 'Gain' });
      expect(await connected.getLayout(gain.ref)).toEqual({ scale: 1 });
      expect(await connected.getStyles(gain.ref)).toEqual({ opacity: 1 });
      expect(await connected.getAccessibility(gain.ref)).toMatchObject({
        role: 'adjustable',
      });
    } finally {
      await browser.close();
    }
  });

  it('rejects node references from an earlier generation', async () => {
    const plugin = await runtime();
    const connected = await driver();
    const tree = await connected.getTree();
    await plugin.reload();
    await until(() => plugin.generation === 2);
    await connected.targets();
    const error = await failure(
      connected.getNode(tree.nodes[0]!.ref),
      'STALE_NODE',
    );
    expect(error.message).toContain('generation 2');
  });

  it('reports a reload during a command as a generation change', async () => {
    const plugin = await runtime();
    const connected = await driver();
    const tree = await connected.getTree();
    plugin.setCommandDelay('UI.getNode', 500);
    const pending = failure(
      connected.getNode(tree.nodes[0]!.ref),
      'GENERATION_CHANGED',
    );
    await until(() => plugin.pendingRequests > 0);
    await plugin.reload();
    expect((await pending).message).toContain('reloaded');
  });

  it('times out and cancels a slow command at the runtime', async () => {
    const plugin = await runtime();
    plugin.setCommandDelay('UI.getTree', 1000);
    const connected = await driver({ timeout: 100 });
    await expect(connected.getTree()).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    await until(() =>
      plugin.commands.some((command) => command.type === 'cancel'),
    );
    plugin.setCommandDelay('UI.getTree', 0);
    expect((await connected.getTree()).nodes).toHaveLength(3);
  });

  it('cancels a command with an AbortSignal', async () => {
    const plugin = await runtime();
    plugin.setCommandDelay('UI.getTree', 1000);
    const connected = await driver();
    const controller = new AbortController();
    const pending = failure(
      connected.getTree({ signal: controller.signal }),
      'CANCELLED',
    );
    await until(() => plugin.pendingRequests > 0);
    controller.abort();
    expect((await pending).message).toContain('cancelled');
    await until(() =>
      plugin.commands.some((command) => command.type === 'cancel'),
    );
  });
});

describe('locators', () => {
  it('finds a node by debug ID, role and name, or text', async () => {
    await runtime();
    const connected = await driver();
    const gain = connected.getByDebugId('gain');
    expect(String(gain)).toBe('getByDebugId("gain")');
    expect(await gain.getBounds()).toEqual({
      x: 12,
      y: 24,
      width: 96,
      height: 96,
    });
    expect((await gain.getNode()).ref.id).toBe('3');
    expect(await gain.getAccessibility()).toMatchObject({ value: 0.5 });
    expect(await gain.getLayout()).toEqual({ scale: 1 });
    expect(await gain.getStyles()).toEqual({ opacity: 1 });
    expect(
      (await connected.getByRole('adjustable', { name: 'Gain' }).getNode()).ref
        .id,
    ).toBe('3');
    expect(
      await connected
        .getByRole('adjustable', { name: 'gai', exact: false })
        .count(),
    ).toBe(1);
    expect(await connected.getByRole('button').count()).toBe(0);
    expect((await connected.getByText('Gain').getNode()).ref.id).toBe('3');
  });

  it('reports missing and duplicate matches', async () => {
    const plugin = await runtime();
    const connected = await driver();
    const missing = await failure(
      connected.getByDebugId('reset').getNode(),
      'ELEMENT_NOT_FOUND',
    );
    expect(missing.message).toContain('getByDebugId("reset")');
    plugin.setNodes([
      node('1', null, ['2', '3']),
      node('2', '1', [], { debugId: 'knob' }),
      node('3', '1', [], { debugId: 'knob' }),
    ]);
    const duplicate = await failure(
      connected.getByDebugId('knob').getNode(),
      'AMBIGUOUS_ELEMENT',
    );
    expect(duplicate.message).toContain('2 nodes');
    expect(await connected.getByDebugId('knob').count()).toBe(2);
  });

  it('resolves again when the node is recreated or the instance reloads', async () => {
    const plugin = await runtime();
    const connected = await driver();
    const gain = connected.getByDebugId('gain');
    expect((await gain.getNode()).ref).toEqual({ generation: 1, id: '3' });
    plugin.setNodes([
      node('1', null, ['9']),
      node('9', '1', [], { debugId: 'gain' }),
    ]);
    expect((await gain.getNode()).ref).toEqual({ generation: 1, id: '9' });
    await plugin.reload();
    await until(() => plugin.generation === 2);
    await connected.targets();
    expect((await gain.getNode()).ref).toEqual({ generation: 2, id: '9' });
  });

  it('retries a read when the node goes between finding and reading it', async () => {
    const plugin = await runtime();
    const connected = await driver();
    plugin.setNodes(originalNodes);
    let reads = 0;
    // The first details read finds the node removed; the next one succeeds.
    const original = connected.getNode.bind(connected);
    connected.getNode = async (ref, options) => {
      if (++reads === 1) {
        plugin.errors.set('UI.getNode', 'Node was removed');
        try {
          return await original(ref, options);
        } finally {
          plugin.errors.delete('UI.getNode');
        }
      }
      return original(ref, options);
    };
    expect((await connected.getByDebugId('gain').getNode()).ref.id).toBe('3');
    expect(reads).toBe(2);
  });
});
