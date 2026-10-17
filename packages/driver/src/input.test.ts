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
  startSimulatedBrowser,
  startSimulatedRuntime,
} from '@soundor/devtools-server/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { connect, type Driver } from './driver';
import type { DriverError } from './errors';
import { parseShortcut } from './input';

type Runtime = Awaited<ReturnType<typeof startSimulatedRuntime>>;

let root: string;
let server: DevToolsServer;
let plugin: Runtime;
let drivers: Driver[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'soundor-driver-input-'));
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

/** The error an action fails with. */
function caught(promise: Promise<unknown>): Promise<DriverError> {
  return promise.then(
    () => {
      throw new Error('Expected a failure');
    },
    (error: unknown) => error as DriverError,
  );
}

async function until(predicate: () => boolean, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Condition not reached');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** The fixture with a reset button (node 4) beside the gain label. */
const withReset = (extra: Parameters<typeof node>[3] = {}) => [
  node('1', null, ['2', '4']),
  ...originalNodes.slice(1),
  node('4', '1', [], {
    debugId: 'reset',
    bounds: { x: 200, y: 10, width: 40, height: 20 },
    ...extra,
  }),
];

describe('locator actions', () => {
  it('clicks through the target, taking control on first use', async () => {
    const connected = await driver();
    expect(connected.hasControl).toBe(false);
    const result = await connected.getByDebugId('gain').click();
    expect(result).toEqual({
      handled: true,
      node: { generation: 1, id: '3' },
    });
    expect(plugin.inputLog).toEqual([
      'pointerdown:3',
      'pointerup:3',
      'click:3',
    ]);
    expect(connected.hasControl).toBe(true);
    // Clicked at the center of its bounds.
    expect(connected.pointer.position).toEqual({ x: 60, y: 72 });
    // One command for the whole click: the press cannot outlive it.
    expect(
      plugin.methods.filter((method) => method === 'Input.dispatchPointer'),
    ).toHaveLength(1);
  });

  it('hovers, scrolls and drags; a drag releases its press', async () => {
    const connected = await driver();
    const gain = connected.getByDebugId('gain');
    await gain.hover();
    await gain.scroll({ deltaY: 120 });
    await gain.drag({ deltaY: -50, steps: 2 });
    expect(plugin.inputLog).toEqual([
      'pointermove:3',
      'pointermove:3',
      'wheel:3:120',
      'pointermove:3',
      'pointerdown:3',
      'pointermove:3',
      // Above the node: the press stays the node's.
      'pointermove:none',
      'pointerup:3',
    ]);
    expect(plugin.holdingInput).toBe(false);
    expect(connected.pointer.position).toEqual({ x: 60, y: 22 });
  });

  it('cancels a drag interrupted after the press: nothing stays pressed', async () => {
    const connected = await driver();
    plugin.setCommandDelay('Input.dispatchPointer', 60);
    const controller = new AbortController();
    const dragging = connected
      .getByDebugId('gain')
      .drag({ deltaX: 40, steps: 10, signal: controller.signal })
      .then(
        () => 'finished',
        (error: { code: string }) => error.code,
      );
    await until(() => plugin.inputLog.includes('pointerdown:3'));
    controller.abort();
    expect(await dragging).toBe('CANCELLED');
    await until(() => plugin.inputLog.includes('pointercancel:3'));
    expect(plugin.holdingInput).toBe(false);
    expect(plugin.inputLog).not.toContain('click:3');
  });

  it('focuses, types and presses keys on a node', async () => {
    const connected = await driver();
    const gain = connected.getByDebugId('gain');
    await gain.type('Hé');
    await gain.press('Control+a');
    expect(plugin.typed).toBe('Héa');
    expect(plugin.inputLog).toEqual([
      'focus:3',
      'keydown:H',
      'keyup:H',
      'keydown:é',
      'keyup:é',
      'focus:3',
      'keydown:Control',
      'keydown:a',
      'keyup:a',
      'keyup:Control',
    ]);
    expect(plugin.holdingInput).toBe(false);
  });

  it('refuses to focus a node that is not focusable', async () => {
    plugin.setNodes(withReset({ properties: { focusable: false } }));
    const connected = await driver();
    await expect(connected.getByDebugId('reset').focus()).rejects.toMatchObject(
      { code: 'ELEMENT_NOT_ACTIONABLE' },
    );
  });
});

describe('actionability', () => {
  it.each([
    ['is not visible', { visible: false }],
    ['is disabled', { accessibility: { states: { disabled: true } } }],
    ['has no size', { bounds: { x: 200, y: 10, width: 0, height: 20 } }],
  ])('waits, then reports a node that %s', async (reason, extra) => {
    plugin.setNodes(withReset(extra));
    const connected = await driver();
    const error = await caught(
      connected.getByDebugId('reset').click({ timeout: 150 }),
    );
    expect(error).toMatchObject({ code: 'ELEMENT_NOT_ACTIONABLE' });
    expect((error as Error).message).toContain(reason);
    expect(plugin.inputLog).toEqual([]);
  });

  it('reports the reason, not a timeout, when the instance is slow', async () => {
    plugin.setNodes(withReset({ visible: false }));
    plugin.setCommandDelay('UI.getTree', 120);
    plugin.setCommandDelay('UI.getNode', 120);
    const connected = await driver();
    const error = await caught(
      connected.getByDebugId('reset').click({ timeout: 150 }),
    );
    expect(error.code).toBe('ELEMENT_NOT_ACTIONABLE');
    expect(error.message).toContain('is not visible');
  });

  it('reports a node another node covers, and clicks once it is uncovered', async () => {
    const covered = [
      node('1', null, ['2', '4', '5']),
      ...originalNodes.slice(1),
      node('4', '1', [], {
        debugId: 'reset',
        bounds: { x: 200, y: 10, width: 40, height: 20 },
      }),
      node('5', '1', ['6'], {
        bounds: { x: 190, y: 0, width: 100, height: 100 },
      }),
      node('6', '5', [], { bounds: { x: 190, y: 0, width: 100, height: 100 } }),
    ];
    plugin.setNodes(covered);
    const connected = await driver();
    const error = await caught(
      connected.getByDebugId('reset').click({ timeout: 150 }),
    );
    expect(error.message).toContain('is covered at (220, 20) by node 6');
    // The cover goes while the click waits.
    const clicking = connected.getByDebugId('reset').click({ timeout: 3000 });
    setTimeout(() => plugin.setNodes(withReset()), 100);
    await clicking;
    expect(plugin.inputLog).toEqual([
      'pointerdown:4',
      'pointerup:4',
      'click:4',
    ]);
  });

  it('waits for a node to appear, and reports one that never does', async () => {
    plugin.setNodes(originalNodes);
    const connected = await driver();
    await expect(
      connected.getByDebugId('reset').click({ timeout: 120 }),
    ).rejects.toMatchObject({ code: 'ELEMENT_NOT_FOUND' });
    const clicking = connected.getByDebugId('reset').click({ timeout: 3000 });
    setTimeout(() => plugin.setNodes(withReset()), 100);
    await clicking;
    expect(plugin.inputLog).toContain('click:4');
  });

  it('fails at once on several matches, without input', async () => {
    plugin.setNodes([
      node('1', null, ['2', '3']),
      node('2', '1', [], { debugId: 'knob' }),
      node('3', '1', [], { debugId: 'knob' }),
    ]);
    const connected = await driver();
    const started = Date.now();
    await expect(
      connected.getByDebugId('knob').click({ timeout: 2000 }),
    ).rejects.toMatchObject({ code: 'AMBIGUOUS_ELEMENT' });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(plugin.inputLog).toEqual([]);
  });
});

describe('control', () => {
  it('never takes control from another client', async () => {
    const browser = await startSimulatedBrowser(server);
    try {
      await browser.request('Control.acquire', plugin.id);
      const connected = await driver();
      const error = await caught(connected.getByDebugId('gain').click());
      expect(error).toMatchObject({ code: 'LEASE_BUSY' });
      expect(error.message).toContain('must release control');
      expect(plugin.inputLog).toEqual([]);
      // Reading still works beside the controller.
      expect((await connected.getTree()).nodes).toHaveLength(3);
    } finally {
      await browser.close();
    }
  });

  it('releases control and held input on disconnect', async () => {
    const connected = await driver();
    await connected.pointer.move(60, 72);
    await connected.pointer.down();
    await connected.keyboard.down('Shift');
    expect(plugin.holdingInput).toBe(true);
    await connected.disconnect();
    await until(() => !plugin.holdingInput);
    expect(plugin.inputLog.slice(-2)).toEqual([
      'pointercancel:3',
      'keyup:Shift',
    ]);
    const observer = await driver();
    expect((await observer.target()).controller).toBeNull();
  });

  it('reports a target without input support', async () => {
    const limited = await startSimulatedRuntime({
      connection: server.connection,
      name: 'No input',
      input: false,
    });
    try {
      const connected = await driver({ targetId: limited.id });
      await expect(
        connected.getByDebugId('gain').click(),
      ).rejects.toMatchObject({ code: 'MISSING_CAPABILITY' });
    } finally {
      await limited.close();
    }
  });
});

describe('low-level input', () => {
  it('moves, presses and releases buttons, and refuses inconsistent input', async () => {
    const connected = await driver();
    await expect(connected.pointer.down()).rejects.toMatchObject({
      code: 'INVALID_OPTIONS',
    });
    await connected.pointer.move(60, 72);
    await connected.pointer.down({ button: 'right' });
    await connected.pointer.up({ button: 'right' });
    await expect(connected.pointer.up()).rejects.toMatchObject({
      code: 'INVALID_OPTIONS',
    });
    await connected.pointer.wheel({ deltaY: -30 });
    expect(plugin.inputLog).toEqual([
      'pointermove:3',
      'pointerdown:3',
      'pointerup:3',
      'wheel:3:-30',
    ]);
    await expect(connected.pointer.move(Number.NaN, 0)).rejects.toMatchObject({
      code: 'INVALID_OPTIONS',
    });
  });

  it('serializes concurrent input instead of tripping over the lease', async () => {
    const connected = await driver();
    await Promise.all([
      connected.keyboard.press('a'),
      connected.keyboard.press('b'),
      connected.keyboard.type('cd'),
    ]);
    expect(plugin.typed).toBe('abcd');
  });

  it('parses shortcuts', () => {
    expect(parseShortcut('Enter')).toEqual({ modifiers: [], key: 'Enter' });
    expect(parseShortcut('Control+Shift+z')).toEqual({
      modifiers: ['Control', 'Shift'],
      key: 'z',
    });
    expect(parseShortcut('+')).toEqual({ modifiers: [], key: '+' });
    expect(parseShortcut('Shift++')).toEqual({
      modifiers: ['Shift'],
      key: '+',
    });
    expect(() => parseShortcut('Hyper+a')).toThrow(/Invalid modifier/);
    expect(() => parseShortcut('')).toThrow(/Invalid key/);
  });
});
