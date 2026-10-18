import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  startDevToolsServer,
  type DevToolsServer,
} from '@soundor/devtools-server';
import {
  startSimulatedBrowser,
  startSimulatedRuntime,
} from '@soundor/devtools-server/testing';
import type { DebugNode, DebugTarget, DebugTree } from '@soundor/driver';
import { runCommand } from 'citty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DRIVER_EXIT_CODES, parseDuration } from '../driver/run';
import { driverCommand } from './driver';

type Runtime = Awaited<ReturnType<typeof startSimulatedRuntime>>;

let root: string;
let server: DevToolsServer;
let runtimes: Runtime[];
let browserKey: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'soundor-cli-driver-'));
  server = await startDevToolsServer({ projectRoot: root, port: 0 });
  browserKey = (
    JSON.parse(await readFile(server.descriptorPath, 'utf8')) as {
      browserKey: string;
    }
  ).browserKey;
  runtimes = [];
});

afterEach(async () => {
  await Promise.all(runtimes.map((runtime) => runtime.close()));
  await server.close();
  await rm(root, { recursive: true, force: true });
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

async function runtime(name?: string): Promise<Runtime> {
  const started = await startSimulatedRuntime({
    connection: server.connection,
    ...(name ? { name } : {}),
  });
  runtimes.push(started);
  return started;
}

/** Runs `soundor driver …` in-process, capturing its output and exit code. */
async function driver(...rawArgs: string[]) {
  let stdout = '';
  let stderr = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  try {
    process.exitCode = undefined;
    await runCommand(driverCommand, { rawArgs });
    return { stdout, stderr, code: Number(process.exitCode ?? 0) };
  } finally {
    vi.mocked(process.stdout.write).mockRestore();
    vi.mocked(process.stderr.write).mockRestore();
  }
}

function session(...rawArgs: string[]) {
  return driver(...rawArgs, '--descriptor', server.descriptorPath);
}

describe('soundor driver', () => {
  it('lists targets as JSON on stdout only', async () => {
    const plugin = await runtime();
    const result = await session('targets', '--json');
    expect(result).toMatchObject({ code: 0, stderr: '' });
    const targets = JSON.parse(result.stdout) as DebugTarget[];
    expect(targets).toEqual([
      expect.objectContaining({ id: plugin.id, name: 'Gain Plugin' }),
    ]);
  });

  it('prints the tree for people and for programs', async () => {
    await runtime();
    const human = await session('tree');
    expect(human.code).toBe(0);
    expect(human.stdout).toBe(
      [
        'View [1]',
        '  View [2]',
        '    Text #gain "Gain" (adjustable "Gain") [3]',
        'generation 1, 3 nodes',
        '',
      ].join('\n'),
    );
    const json = await session('tree', '--json');
    const tree = JSON.parse(json.stdout) as DebugTree;
    expect(tree.nodes.map((node) => node.ref.id)).toEqual(['1', '2', '3']);
    // Nothing but JSON: no banner, no ANSI.
    expect(json.stdout).not.toContain('\u001b[');
  });

  it('inspects a node by debug ID, role or text', async () => {
    await runtime();
    for (const query of [
      ['gain'],
      ['--role', 'adjustable', '--name', 'Gain'],
      ['--text', 'Gain'],
    ]) {
      const result = await session('inspect', ...query, '--json');
      expect(result.code).toBe(0);
      expect((JSON.parse(result.stdout) as DebugNode).debugId).toBe('gain');
    }
    const human = await session('inspect', 'gain');
    expect(human.stdout).toContain('bounds: x 12, y 24, 96 × 96');
  });

  it('reports a missing node as a structured error on stderr', async () => {
    await runtime();
    const result = await session('inspect', 'reset', '--json');
    expect(result.code).toBe(DRIVER_EXIT_CODES.element);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        code: 'ELEMENT_NOT_FOUND',
        message: 'getByDebugId("reset") matches no node; debug IDs here: gain',
      },
    });
    const human = await session('inspect', 'reset');
    expect(human.stderr).toBe(
      'soundor driver: getByDebugId("reset") matches no node; debug IDs here: gain (ELEMENT_NOT_FOUND)\n',
    );
  });

  it('rejects invalid arguments before connecting', async () => {
    for (const args of [
      ['inspect'],
      ['inspect', 'gain', '--text', 'Gain'],
      ['inspect', '--name', 'Gain', '--text', 'Gain'],
      ['tree', '--timeout', 'soon'],
    ]) {
      const result = await driver(...args, '--json');
      expect(result.code).toBe(DRIVER_EXIT_CODES.invalid);
      expect(JSON.parse(result.stderr).error.code).toBe('INVALID_OPTIONS');
    }
  });

  it('requires a target among several, and selects one by ID or name', async () => {
    await runtime();
    const second = await runtime('Second Gain Plugin');
    const ambiguous = await session('tree', '--json');
    expect(ambiguous.code).toBe(DRIVER_EXIT_CODES.invalid);
    expect(JSON.parse(ambiguous.stderr).error.code).toBe('AMBIGUOUS_TARGET');
    expect((await session('tree', '--target', second.id)).code).toBe(0);
    expect(
      (await session('tree', '--target-name', 'Second Gain Plugin')).code,
    ).toBe(0);
    const missing = await session('tree', '--target', 'gone', '--json');
    expect(missing.code).toBe(DRIVER_EXIT_CODES.unavailable);
    expect(JSON.parse(missing.stderr).error.code).toBe('TARGET_NOT_FOUND');
  });

  it('reports a session without targets', async () => {
    const result = await session('tree', '--json');
    expect(result.code).toBe(DRIVER_EXIT_CODES.unavailable);
    expect(JSON.parse(result.stderr).error.code).toBe('NO_TARGETS');
    const listed = await session('targets');
    expect(listed).toMatchObject({ code: 0, stderr: '' });
    expect(listed.stdout).toContain('No Soundor instance');
  });

  it('authenticates with an endpoint and the key from the environment only', async () => {
    await runtime();
    vi.stubEnv('SOUNDOR_DEVTOOLS_BROWSER_KEY', browserKey);
    try {
      const result = await driver(
        'tree',
        '--endpoint',
        server.connection.endpoint,
        '--json',
      );
      expect(result.code).toBe(0);
      expect(result.stdout + result.stderr).not.toContain(browserKey);
      vi.stubEnv('SOUNDOR_DEVTOOLS_BROWSER_KEY', 'e'.repeat(64));
      const rejected = await driver(
        'tree',
        '--endpoint',
        server.connection.endpoint,
        '--json',
      );
      expect(rejected.code).toBe(DRIVER_EXIT_CODES.authentication);
      expect(rejected.stderr).not.toContain('e'.repeat(64));
      expect(JSON.parse(rejected.stderr).error.code).toBe(
        'AUTHENTICATION_FAILED',
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('reads the descriptor path from the environment', async () => {
    await runtime();
    vi.stubEnv('SOUNDOR_DEVTOOLS_SESSION', server.descriptorPath);
    try {
      expect((await driver('targets', '--json')).code).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
    const missing = await driver(
      'tree',
      '--descriptor',
      join(root, 'gone.json'),
      '--json',
    );
    expect(missing.code).toBe(DRIVER_EXIT_CODES.authentication);
    expect(JSON.parse(missing.stderr).error.code).toBe('INVALID_DESCRIPTOR');
  });

  it('times out, and cancels the command at the runtime', async () => {
    const plugin = await runtime();
    plugin.setCommandDelay('UI.getTree', 2000);
    const result = await session('tree', '--timeout', '100ms', '--json');
    expect(result.code).toBe(DRIVER_EXIT_CODES.timeout);
    expect(JSON.parse(result.stderr).error.code).toBe('TIMEOUT');
    const deadline = Date.now() + 3000;
    while (!plugin.commands.some((command) => command.type === 'cancel')) {
      if (Date.now() > deadline)
        throw new Error('No cancel reached the runtime');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  });

  it('inspects and clicks beside another client', async () => {
    const plugin = await runtime();
    const browser = await startSimulatedBrowser(server);
    try {
      // The other client holds a key down: its own, not the command's.
      await browser.request('Input.dispatchKey', plugin.id, {
        action: 'down',
        key: 'Shift',
      });
      expect((await session('inspect', 'gain')).code).toBe(0);
      expect((await session('click', 'gain')).code).toBe(0);
      expect(plugin.inputLog.slice(-1)).toEqual(['click:3']);
      expect(plugin.holdingInput).toBe(true);
    } finally {
      await browser.close();
    }
  });

  it('reports a session that ended', async () => {
    const endpoint = server.connection.endpoint;
    await server.close();
    vi.stubEnv('SOUNDOR_DEVTOOLS_BROWSER_KEY', browserKey);
    try {
      const result = await driver('tree', '--endpoint', endpoint, '--json');
      expect(result.code).toBe(DRIVER_EXIT_CODES.unavailable);
      expect(JSON.parse(result.stderr).error.code).toBe('SERVER_UNAVAILABLE');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('soundor driver input', () => {
  it('clicks a node by debug ID through the target', async () => {
    const plugin = await runtime();
    const result = await session('click', 'gain', '--json');
    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(JSON.parse(result.stdout)).toEqual({
      handled: true,
      node: { generation: 1, id: '3' },
    });
    expect(plugin.inputLog).toEqual([
      'pointerdown:3',
      'pointerup:3',
      'click:3',
    ]);
    expect((await session('click', 'gain')).stdout).toBe(
      'clicked: handled (node 3)\n',
    );
  });

  it('hovers, moves, drags, scrolls, focuses, presses keys and types', async () => {
    const plugin = await runtime();
    for (const args of [
      ['hover', 'gain'],
      ['move', '--x', '20', '--y', '30'],
      ['drag', 'gain', '--dy', '-10', '--steps', '1'],
      ['scroll', 'gain', '--dy', '120'],
      ['scroll', '--x', '60', '--y', '72', '--dy', '-40'],
      ['focus', '--role', 'adjustable', '--name', 'Gain'],
      ['key', 'Control+a'],
      ['type', 'Hi', '--debug-id', 'gain'],
      ['click', '--text', 'Gain', '--button', 'right'],
    ]) {
      const result = await session(...args, '--json');
      expect({ args, ...result }).toMatchObject({ args, code: 0, stderr: '' });
      JSON.parse(result.stdout);
    }
    expect(plugin.inputLog).toEqual([
      'pointermove:3',
      'pointermove:3',
      'pointermove:3',
      'pointerdown:3',
      'pointermove:3',
      'pointerup:3',
      // Released on the node it was pressed on: a click.
      'click:3',
      'pointermove:3',
      'wheel:3:120',
      'wheel:3:-40',
      'focus:3',
      'keydown:Control',
      'keydown:a',
      'keyup:a',
      'keyup:Control',
      'focus:3',
      'keydown:H',
      'keyup:H',
      'keydown:i',
      'keyup:i',
      'pointerdown:3',
      'pointerup:3',
    ]);
    expect(plugin.typed).toBe('aHi');
    expect(plugin.holdingInput).toBe(false);
  });

  it('exits with the code of each failure', async () => {
    const plugin = await runtime();
    const missing = await session(
      'click',
      'reset',
      '--json',
      '--timeout',
      '200ms',
    );
    expect(missing.code).toBe(DRIVER_EXIT_CODES.element);
    expect(JSON.parse(missing.stderr).error.code).toBe('ELEMENT_NOT_FOUND');
    for (const args of [
      ['move', '--x', 'left', '--y', '1'],
      ['scroll', '--dy', '10'],
      ['key'],
      ['type'],
      ['click', 'gain', '--button', 'back'],
      ['drag', 'gain', '--steps', '0'],
    ]) {
      const result = await session(...args, '--json');
      expect({ args, code: result.code }).toEqual({
        args,
        code: DRIVER_EXIT_CODES.invalid,
      });
    }
    expect(plugin.inputLog).toEqual([]);
  });

  it('reports a target without input support', async () => {
    const limited = await startSimulatedRuntime({
      connection: server.connection,
      input: false,
    });
    runtimes.push(limited);
    const result = await session('click', 'gain', '--json');
    expect(result.code).toBe(DRIVER_EXIT_CODES.unsupported);
    expect(JSON.parse(result.stderr).error.code).toBe('MISSING_CAPABILITY');
  });
});

describe('soundor driver screenshot', () => {
  it('saves the rendered view and prints where, never the image', async () => {
    const plugin = await runtime();
    const path = join(root, 'view.png');
    const result = await session('screenshot', path, '--json');
    expect(result).toMatchObject({ code: 0, stderr: '' });
    const saved = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(saved).toMatchObject({
      path,
      width: 160,
      height: 140,
      scale: 1,
      format: 'png',
    });
    const bytes = await readFile(path);
    expect(saved['bytes']).toBe(bytes.length);
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(plugin.captures).toBe(1);
    const human = await session('screenshot', path, '--debug-id', 'gain');
    expect(human.stdout).toMatch(
      /^saved .*view\.png \(96×96 pixels, \d+ bytes\)\n$/,
    );
  });

  it('exits with the code of each failure', async () => {
    const plugin = await runtime();
    const missingPath = await session('screenshot', '--json');
    expect(missingPath.code).toBe(DRIVER_EXIT_CODES.invalid);
    plugin.failCaptures('Nothing is rendered yet');
    const failed = await session('screenshot', join(root, 'x.png'), '--json');
    expect(failed.code).toBe(DRIVER_EXIT_CODES.unsupported);
    expect(JSON.parse(failed.stderr).error).toMatchObject({
      code: 'SCREENSHOT_UNAVAILABLE',
    });
    expect(failed.stdout).toBe('');
  });
});

describe('durations', () => {
  it.each([
    ['250', 250],
    ['250ms', 250],
    ['1.5s', 1500],
    ['2m', 120000],
  ])('reads %s', (value, milliseconds) => {
    expect(parseDuration(value)).toBe(milliseconds);
  });

  it.each(['0', '-1s', 'soon', '5h', ''])('rejects %s', (value) => {
    expect(() => parseDuration(value)).toThrow(
      expect.objectContaining({ code: 'INVALID_OPTIONS' }),
    );
  });
});
