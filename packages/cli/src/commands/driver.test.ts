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
        message: 'getByDebugId("reset") matches no node',
      },
    });
    const human = await session('inspect', 'reset');
    expect(human.stderr).toBe(
      'soundor driver: getByDebugId("reset") matches no node (ELEMENT_NOT_FOUND)\n',
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

  it('inspects while another client controls the target', async () => {
    const plugin = await runtime();
    const browser = await startSimulatedBrowser(server);
    try {
      await browser.request('Control.acquire', plugin.id);
      expect((await session('inspect', 'gain')).code).toBe(0);
      // Reading took no control: the other client still has it.
      const [target] = JSON.parse(
        (await session('targets', '--json')).stdout,
      ) as DebugTarget[];
      expect(target!.controller).not.toBeNull();
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
