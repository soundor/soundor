import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  startDevToolsServer,
  type DevToolsServer,
} from '@soundor/devtools-server';
import {
  node,
  originalNodes,
  startSimulatedRuntime,
} from '@soundor/devtools-server/testing';
import { connect, type Driver } from '@soundor/driver';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

type Runtime = Awaited<ReturnType<typeof startSimulatedRuntime>>;

let root: string;
let server: DevToolsServer;
let plugin: Runtime;
let driver: Driver;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'soundor-vitest-e2e-'));
  server = await startDevToolsServer({ projectRoot: root, port: 0 });
  plugin = await startSimulatedRuntime({ connection: server.connection });
  driver = await connect({ descriptorPath: server.descriptorPath });
  await driver.waitForTarget();
});

afterEach(async () => {
  await driver.disconnect();
  await plugin.close();
  await server.close();
  await rm(root, { recursive: true, force: true });
});

const parent = () => originalNodes.slice(0, 2);
const gain = (extra: Parameters<typeof node>[3]) =>
  node('3', '2', [], { type: 'Text', text: 'Gain', ...extra });
const later = (change: () => void) => setTimeout(change, 60);

describe('toBeVisible', () => {
  test('passes for a visible node', async () => {
    await expect(driver.getByText('Gain')).toBeVisible();
  });

  test('retries until the node appears', async () => {
    plugin.setNodes(parent());
    later(() => plugin.setNodes([...parent(), gain({})]));
    await expect(driver.getByText('Gain')).toBeVisible();
  });

  test('retries until a hidden node shows', async () => {
    plugin.setNodes([...parent(), gain({ visible: false })]);
    later(() => plugin.setNodes([...parent(), gain({})]));
    await expect(driver.getByText('Gain')).toBeVisible();
  });

  test('fails with what it saw, within the timeout', async () => {
    const started = Date.now();
    await expect(
      expect(driver.getByText('Nope')).toBeVisible({ timeout: 100 }),
    ).rejects.toThrow('getByText("Nope") was not visible within 100 ms');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test('fails at once for an ambiguous query', async () => {
    plugin.setNodes([
      ...parent(),
      gain({}),
      node('4', '2', [], { type: 'Text', text: 'Gain' }),
    ]);
    await expect(
      expect(driver.getByText('Gain')).toBeVisible(),
    ).rejects.toThrow('matches 2 nodes');
  });

  test('.not waits for it to go', async () => {
    later(() => plugin.setNodes(parent()));
    await expect(driver.getByText('Gain')).not.toBeVisible();
  });

  test('.not fails while it stays', async () => {
    await expect(
      expect(driver.getByText('Gain')).not.toBeVisible({ timeout: 100 }),
    ).rejects.toThrow('was not hidden within 100 ms');
  });

  test('wants a locator', async () => {
    await expect(expect('Gain').toBeVisible()).rejects.toThrow(
      'toBeVisible expects a locator',
    );
  });
});

describe('toBeHidden', () => {
  test('passes for a node that is missing or not visible', async () => {
    await expect(driver.getByText('Nope')).toBeHidden();
    plugin.setNodes([...parent(), gain({ visible: false })]);
    await expect(driver.getByText('Gain')).toBeHidden();
  });

  test('retries until the node goes', async () => {
    later(() => plugin.setNodes(parent()));
    await expect(driver.getByText('Gain')).toBeHidden();
  });

  test('fails while it stays', async () => {
    await expect(
      expect(driver.getByText('Gain')).toBeHidden({ timeout: 100 }),
    ).rejects.toThrow('was not hidden within 100 ms');
  });

  test('.not waits for it to show', async () => {
    plugin.setNodes(parent());
    later(() => plugin.setNodes([...parent(), gain({})]));
    await expect(driver.getByText('Gain')).not.toBeHidden();
  });
});

describe('toHaveText', () => {
  const byId = () => driver.getByDebugId('gain');

  test('compares a string exactly, a RegExp by matching', async () => {
    await expect(byId()).toHaveText('Gain');
    await expect(byId()).toHaveText(/^Ga/);
    await expect(
      expect(byId()).toHaveText('Gai', { timeout: 50 }),
    ).rejects.toThrow('to have text "Gai"');
  });

  test('retries until the text changes', async () => {
    later(() =>
      plugin.setNodes([
        ...parent(),
        gain({ debugId: 'gain', text: 'Gain: 1' }),
      ]),
    );
    await expect(byId()).toHaveText('Gain: 1');
  });

  test('fails with the text it saw', async () => {
    await expect(
      expect(byId()).toHaveText('Other', { timeout: 50 }),
    ).rejects.toThrow(
      'Expected getByDebugId("gain") to have text "Other" within 50 ms: it has "Gain"',
    );
  });

  test('fails for a missing node', async () => {
    await expect(
      expect(driver.getByDebugId('nope')).toHaveText('Gain', { timeout: 50 }),
    ).rejects.toThrow('it matches no node');
  });

  test('fails for an ambiguous query', async () => {
    plugin.setNodes([
      ...parent(),
      gain({}),
      node('4', '2', [], { type: 'Text', text: 'Gain' }),
    ]);
    await expect(
      expect(driver.getByText('Gain')).toHaveText('Gain', { timeout: 50 }),
    ).rejects.toThrow('it matches 2 nodes');
  });

  test('.not waits for the text to change', async () => {
    later(() =>
      plugin.setNodes([...parent(), gain({ debugId: 'gain', text: 'Mute' })]),
    );
    await expect(byId()).not.toHaveText('Gain');
  });

  test('.not fails while the text stays', async () => {
    await expect(
      expect(byId()).not.toHaveText('Gain', { timeout: 50 }),
    ).rejects.toThrow('not to have text "Gain"');
  });
});

test('a lost plugin fails at once, not at the timeout', async () => {
  await plugin.close();
  await expect
    .poll(() => driver.targets().then((targets) => targets.length))
    .toBe(0);
  const started = Date.now();
  await expect(
    expect(driver.getByText('Gain')).toBeVisible({ timeout: 4000 }),
  ).rejects.toThrow();
  expect(Date.now() - started).toBeLessThan(3000);
});
