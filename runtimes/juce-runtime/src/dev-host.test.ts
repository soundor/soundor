import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Logger } from '@soundor/runtime-sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  chooseDevLaunch,
  DevVst3Host,
  findVst3Host,
  loadHostModule,
  prepareHostExecutable,
  type HostModule,
  type Vst3HostAvailability,
} from './dev-host';

const coded = (code: string, message = code): Error =>
  Object.assign(new Error(message), { code });

const available = {
  status: 'available',
  module: {} as HostModule,
} as Vst3HostAvailability;
const absent: Vst3HostAvailability = { status: 'absent' };

describe('chooseDevLaunch', () => {
  it.each([
    [['vst3', 'standalone'], available, 'vst3'],
    [['vst3', 'standalone'], absent, 'standalone'],
    [['vst3'], available, 'vst3'],
    [['vst3'], absent, false],
    [['standalone'], absent, 'standalone'],
    [['au'], absent, false],
  ] as const)('%j, host %j: %j', (formats, host, expected) => {
    expect(chooseDevLaunch({ formats }, host)).toBe(expected);
  });

  it('falls back on a platform the host does not ship for', () => {
    expect(
      chooseDevLaunch(
        { formats: ['vst3', 'standalone'] },
        { status: 'unsupported', reason: 'no' },
      ),
    ).toBe('standalone');
  });

  it('takes what the config says, and fails if it cannot', () => {
    const formats = ['vst3', 'standalone'] as const;
    expect(
      chooseDevLaunch({ formats, devLaunch: 'standalone' }, available),
    ).toBe('standalone');
    expect(chooseDevLaunch({ formats, devLaunch: false }, available)).toBe(
      false,
    );
    expect(() =>
      chooseDevLaunch({ formats, devLaunch: 'vst3' }, absent),
    ).toThrow(/devDependencies/);
    expect(() =>
      chooseDevLaunch(
        { formats, devLaunch: 'vst3' },
        { status: 'unsupported', reason: 'no Linux arm64' },
      ),
    ).toThrow(/no Linux arm64/);
  });
});

describe('loadHostModule', () => {
  async function project(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'juce-dev-host-'));
  }

  it('finds nothing in a project without the package', async () => {
    // Though this package links it, and pnpm's NODE_PATH may reach it.
    expect(await loadHostModule(await project())).toBeUndefined();
  });

  it("loads the project's copy through its entry", async () => {
    const root = await project();
    const dir = join(root, 'node_modules', '@soundor', 'vst3-host');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        name: '@soundor/vst3-host',
        type: 'module',
        exports: {
          '.': { import: './entry.mjs' },
          './package.json': './package.json',
        },
      }),
    );
    await writeFile(join(dir, 'entry.mjs'), 'export const which = "project";');
    expect(await loadHostModule(root)).toMatchObject({ which: 'project' });
  });

  it('fails on an installed package it cannot load', async () => {
    const root = await project();
    const dir = join(root, 'node_modules', '@soundor', 'vst3-host');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        name: '@soundor/vst3-host',
        exports: {
          '.': { import: './missing.mjs' },
          './package.json': './package.json',
        },
      }),
    );
    await expect(loadHostModule(root)).rejects.toThrow(/missing\.mjs/);
  });
});

describe('findVst3Host', () => {
  const withResolve = (resolveHost: () => unknown) => async () =>
    ({ resolveHost }) as unknown as HostModule;

  it('tells an unsupported platform from any other failure', async () => {
    expect(
      await findVst3Host(
        '/',
        withResolve(() => {
          throw coded('unsupported-platform', 'no arm64');
        }),
      ),
    ).toEqual({ status: 'unsupported', reason: 'no arm64' });
    expect(
      (
        await findVst3Host(
          '/',
          withResolve(() => {
            throw coded('executable-not-found');
          }),
        )
      ).status,
    ).toBe('available');
  });
});

describe('prepareHostExecutable', () => {
  it('prepares only what resolving could not find', async () => {
    const prepareHost = vi.fn(async () => ({ executable: '/built' }));
    const found = {
      resolveHost: () => ({ executable: '/selected' }),
      prepareHost,
    } as unknown as HostModule;
    expect(await prepareHostExecutable(found, () => {})).toBe('/selected');
    expect(prepareHost).not.toHaveBeenCalled();

    const missing = {
      resolveHost: () => {
        throw coded('executable-not-found');
      },
      prepareHost,
    } as unknown as HostModule;
    expect(await prepareHostExecutable(missing, () => {})).toBe('/built');
  });

  it('does not build over any other failure', async () => {
    const prepareHost = vi.fn();
    const module = {
      resolveHost: () => {
        throw coded('incompatible-host');
      },
      prepareHost,
    } as unknown as HostModule;
    await expect(prepareHostExecutable(module, () => {})).rejects.toThrow(
      'incompatible-host',
    );
    expect(prepareHost).not.toHaveBeenCalled();
  });
});

describe('DevVst3Host', () => {
  class FakeHost extends EventEmitter {
    state = {
      component: new Uint8Array([1, 2]),
      controller: new Uint8Array([3]),
    };
    restored: unknown[] = [];
    closed = 0;
    refuseState = false;
    failGetState = false;
    #exit!: () => void;
    exited = new Promise<void>((resolve) => (this.#exit = resolve));
    getState = async () => {
      if (this.failGetState) throw new Error('gone');
      return this.state;
    };
    setState = async (state: unknown) => {
      if (this.refuseState) throw new Error('bad state');
      this.restored.push(state);
    };
    close = async () => {
      this.closed += 1;
      this.#exit();
    };
    die = () => this.#exit();
  }

  async function setUp(env: Record<string, string> = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'juce-dev-host-'));
    const stateFile = join(dir, 'state', 'vst3.json');
    const hosts: FakeHost[] = [];
    const nextHost: { configure?: (host: FakeHost) => void } = {};
    const launches: Record<string, unknown>[] = [];
    const logs: string[] = [];
    const log = (message: string) => logs.push(message);
    const module = {
      resolveHost: () => ({ executable: '/host' }),
      prepareHost: vi.fn(),
      launchHost: async (options: Record<string, unknown>) => {
        launches.push(options);
        const host = new FakeHost();
        nextHost.configure?.(host);
        hosts.push(host);
        return host;
      },
    } as unknown as HostModule;
    const make = () =>
      new DevVst3Host({
        module,
        plugin: '/p.vst3',
        stateFile,
        logger: { info: log, warn: log, error: log } as unknown as Logger,
        signal: new AbortController().signal,
        environment: () => env,
      });
    return { dir, stateFile, hosts, nextHost, launches, logs, make };
  }

  it('asks for the editor in a process Ctrl+C does not reach', async () => {
    const { make, launches } = await setUp({ SOUNDOR_DEVTOOLS_SESSION: '/d' });
    await make().launch();
    expect(launches[0]).toMatchObject({
      plugin: '/p.vst3',
      editor: true,
      presentation: null,
      detached: true,
      env: { SOUNDOR_DEVTOOLS_SESSION: '/d' },
    });
  });

  it("shows the host's log without repeating the UI's", async () => {
    const { make, launches, logs } = await setUp();
    await make().launch();
    const onLog = launches[0]!['onLog'] as (line: string) => void;
    onLog('[soundor] UI started (70 ms)');
    onLog('a line the plugin printed');
    expect(logs).toContain('a line the plugin printed');
    expect(logs.join()).not.toContain('UI started');
  });

  it('saves on close and restores on the next launch', async () => {
    const { make, hosts, stateFile } = await setUp();
    const first = make();
    await first.launch();
    expect(hosts[0]!.restored).toEqual([]);
    await first.close();
    expect(hosts[0]!.closed).toBe(1);
    expect(JSON.parse(await readFile(stateFile, 'utf8'))).toEqual({
      component: Buffer.from([1, 2]).toString('base64'),
      controller: Buffer.from([3]).toString('base64'),
    });

    await make().launch();
    expect(hosts[1]!.restored).toEqual([
      {
        component: Buffer.from([1, 2]),
        controller: Buffer.from([3]),
      },
    ]);
  });

  it('keeps one host, carrying the state over a relaunch', async () => {
    const { make, hosts } = await setUp();
    const dev = make();
    await dev.launch();
    await dev.launch();
    expect(hosts).toHaveLength(2);
    expect(hosts[0]!.closed).toBe(1);
    expect(hosts[1]!.closed).toBe(0);
    expect(hosts[1]!.restored).toHaveLength(1);
  });

  it('saves and ends when the window closes, and can open again', async () => {
    const { make, hosts, stateFile } = await setUp();
    const dev = make();
    await dev.launch();
    hosts[0]!.emit('editorClosed');
    await dev.launch();
    expect(hosts[0]!.closed).toBe(1);
    expect(hosts).toHaveLength(2);
    expect(await readFile(stateFile, 'utf8')).toContain('component');
  });

  it('starts clean from a state the plugin refuses, and forgets it', async () => {
    const { make, hosts, nextHost, stateFile, logs } = await setUp();
    await mkdir(join(stateFile, '..'), { recursive: true });
    await writeFile(
      stateFile,
      JSON.stringify({ component: 'AQ==', controller: 'Ag==' }),
    );
    nextHost.configure = (host) => {
      host.refuseState = true;
      nextHost.configure = undefined;
    };
    await make().launch();
    expect(hosts).toHaveLength(2);
    expect(hosts[0]!.closed).toBe(1);
    expect(hosts[1]!.closed).toBe(0);
    await expect(readFile(stateFile)).rejects.toThrow();
    expect(logs.join()).toContain('did not accept its saved state');
  });

  it('ignores a state file it cannot read', async () => {
    const { make, hosts, stateFile, logs } = await setUp();
    await mkdir(join(stateFile, '..'), { recursive: true });
    await writeFile(stateFile, '{ not json');
    await make().launch();
    expect(hosts[0]!.restored).toEqual([]);
    expect(logs.join()).toContain('Ignoring');
  });

  it('still closes the host when the state cannot be saved', async () => {
    const { make, hosts, nextHost, stateFile, logs } = await setUp();
    nextHost.configure = (host) => {
      host.failGetState = true;
    };
    const dev = make();
    await dev.launch();
    await dev.close();
    expect(hosts[0]!.closed).toBe(1);
    await expect(readFile(stateFile)).rejects.toThrow();
    expect(logs.join()).toContain('Could not save');
  });

  it('reports a host that dies, and launches again', async () => {
    const { make, hosts, logs } = await setUp();
    const dev = make();
    await dev.launch();
    hosts[0]!.die();
    await hosts[0]!.exited;
    await Promise.resolve();
    expect(logs.join()).toContain('exited');
    await dev.launch();
    expect(hosts).toHaveLength(2);
    expect(hosts[0]!.closed).toBe(0);
  });

  it('opens nothing once closed', async () => {
    const none = await setUp();
    const closed = none.make();
    await closed.close();
    await closed.launch();
    expect(none.hosts).toEqual([]);
  });
});
