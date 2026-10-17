import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

import {
  startDevToolsServer,
  type DevToolsServer,
} from '@soundor/devtools-server';
import {
  SIMULATED_VIEW,
  node,
  originalNodes,
  startSimulatedRuntime,
} from '@soundor/devtools-server/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { connect, type Driver } from './driver';

type Runtime = Awaited<ReturnType<typeof startSimulatedRuntime>>;

let root: string;
let server: DevToolsServer;
let plugin: Runtime;
let drivers: Driver[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'soundor-driver-capture-'));
  server = await startDevToolsServer({ projectRoot: root, port: 0 });
  plugin = await startSimulatedRuntime({ connection: server.connection });
  drivers = [];
});

afterEach(async () => {
  await Promise.all(drivers.map((driver) => driver.disconnect()));
  await plugin.close();
  await server.close();
  await rm(root, { recursive: true, force: true });
});

async function driver(options: Parameters<typeof connect>[0] = {}) {
  const connected = await connect({
    descriptorPath: server.descriptorPath,
    ...options,
  });
  drivers.push(connected);
  return connected;
}

/** The RGBA pixel at (x, y) of an 8-bit RGBA PNG without filters. */
function pixel(png: Uint8Array, x: number, y: number): number[] {
  const bytes = Buffer.from(png);
  const width = bytes.readUInt32BE(16);
  const data: Buffer[] = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at);
    if (bytes.toString('latin1', at + 4, at + 8) === 'IDAT')
      data.push(bytes.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const rows = inflateSync(Buffer.concat(data));
  const start = y * (width * 4 + 1) + 1 + x * 4;
  return [...rows.subarray(start, start + 4)];
}

describe('screenshots', () => {
  it('captures the rendered view as PNG, and saves it', async () => {
    const connected = await driver();
    const path = join(root, 'view.png');
    const shot = await connected.screenshot({ path });
    expect(shot).toMatchObject({
      width: SIMULATED_VIEW.width,
      height: SIMULATED_VIEW.height,
      scale: 1,
      format: 'png',
      path,
    });
    expect([...shot.data.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(new Uint8Array(await readFile(path))).toEqual(shot.data);
    // What the runtime drew: the gain node's box, over the background.
    expect(pixel(shot.data, 50, 50)).toEqual([40, 90, 220, 255]);
    expect(pixel(shot.data, 5, 5)).toEqual([255, 255, 255, 255]);
    // Captures read the view: no control was taken.
    expect(connected.hasControl).toBe(false);
  });

  it('captures the part of the view a node covers', async () => {
    const connected = await driver();
    const shot = await connected.getByDebugId('gain').screenshot();
    expect(shot).toMatchObject({ width: 96, height: 96 });
    expect(shot.path).toBeUndefined();
  });

  it('reports captures a target cannot make, and stays usable', async () => {
    const connected = await driver();
    plugin.failCaptures('Nothing is rendered yet');
    await expect(connected.screenshot()).rejects.toMatchObject({
      code: 'SCREENSHOT_UNAVAILABLE',
      message: expect.stringContaining('Nothing is rendered yet'),
    });
    plugin.failCaptures(undefined);
    plugin.skipCaptureUploads(true);
    await expect(connected.screenshot()).rejects.toMatchObject({
      code: 'SCREENSHOT_UNAVAILABLE',
    });
    plugin.skipCaptureUploads(false);
    expect((await connected.screenshot()).width).toBe(SIMULATED_VIEW.width);
    expect((await connected.getTree()).nodes).toHaveLength(3);
  });

  it('reports a target without the capture capability', async () => {
    const limited = await startSimulatedRuntime({
      connection: server.connection,
      name: 'No capture',
      capture: false,
    });
    try {
      const connected = await driver({ targetId: limited.id });
      await expect(connected.screenshot()).rejects.toMatchObject({
        code: 'MISSING_CAPABILITY',
      });
      expect(limited.captures).toBe(0);
    } finally {
      await limited.close();
    }
  });

  it('refuses a path it cannot write, after capturing', async () => {
    const connected = await driver();
    await expect(
      connected.screenshot({ path: join(root, 'missing', 'view.png') }),
    ).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
  });
});

describe('waiting', () => {
  it('waits for a node to appear, become hidden and go', async () => {
    const connected = await driver();
    const reset = connected.getByDebugId('reset');
    const withReset = (visible: boolean) => [
      node('1', null, ['2', '4']),
      ...originalNodes.slice(1),
      node('4', '1', [], { debugId: 'reset', visible }),
    ];
    expect(await reset.isVisible()).toBe(false);
    setTimeout(() => plugin.setNodes(withReset(true)), 80);
    await reset.waitFor({ timeout: 3000 });
    expect(await reset.isVisible()).toBe(true);
    setTimeout(() => plugin.setNodes(withReset(false)), 80);
    await reset.waitFor({ state: 'hidden', timeout: 3000 });
    await reset.waitFor({ state: 'attached' });
    setTimeout(() => plugin.setNodes(originalNodes), 80);
    await reset.waitFor({ state: 'detached', timeout: 3000 });
  });

  it('says what it saw when it times out', async () => {
    const connected = await driver();
    await expect(
      connected.getByDebugId('reset').waitFor({ timeout: 120 }),
    ).rejects.toMatchObject({
      code: 'TIMEOUT',
      message:
        'getByDebugId("reset") was not visible within 120 ms: it matches no node',
    });
  });

  it('lists the debug IDs there are when one is not found', async () => {
    const connected = await driver();
    await expect(
      connected.getByDebugId('gian').getNode(),
    ).rejects.toMatchObject({
      code: 'ELEMENT_NOT_FOUND',
      message: 'getByDebugId("gian") matches no node; debug IDs here: gain',
    });
  });
});
