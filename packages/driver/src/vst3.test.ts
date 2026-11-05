import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { startSimulatedRuntime } from '@soundor/devtools-server/testing';
import {
  launchHost,
  type LaunchOptions,
  type Vst3Host,
} from '@soundor/vst3-host';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { isDriverError, type DriverErrorCode } from './errors';
import { launch, type Vst3Plugin } from './vst3';

vi.mock('@soundor/vst3-host', () => ({ launchHost: vi.fn() }));

type Runtime = Awaited<ReturnType<typeof startSimulatedRuntime>>;

/** A host whose editor is a simulated runtime in the session it was given. */
class FakeHost {
  readonly info = { name: 'Fake Plugin' };
  readonly openEditor = vi.fn(() => this.#open());
  readonly closes = vi.fn();
  // What the host's requests fail with, once it has ended.
  readonly getEditor = vi.fn(async () => {
    throw new Error('the VST3 host exited (signal SIGSEGV)');
  });
  readonly exited: Promise<void>;
  readonly #descriptorPath: string;
  readonly #connects: boolean;
  #exit!: () => void;
  #runtime: Runtime | undefined;

  constructor(descriptorPath: string, connects: boolean) {
    this.#descriptorPath = descriptorPath;
    this.#connects = connects;
    this.exited = new Promise((resolve) => (this.#exit = resolve));
  }

  async #open(): Promise<{ open: boolean }> {
    if (!this.#runtime && this.#connects) {
      const { endpoint, sessionId, token } = JSON.parse(
        await readFile(this.#descriptorPath, 'utf8'),
      ) as { endpoint: string; sessionId: string; token: string };
      this.#runtime = await startSimulatedRuntime({
        connection: { endpoint, sessionId, token },
      });
    }
    return { open: true };
  }

  /** Closes the editor, which unregisters first, as the bridge does. */
  async closeEditor(): Promise<void> {
    await this.#runtime?.close();
    this.#runtime = undefined;
  }

  exit(): void {
    this.#exit();
  }

  async close(): Promise<void> {
    this.closes();
    await this.closeEditor();
    this.exit();
  }
}

let fake: FakeHost | undefined;
let plugin: Vst3Plugin | undefined;
let launchOptions: LaunchOptions | undefined;

function hostLaunches({ connects = true }: { connects?: boolean } = {}): void {
  vi.mocked(launchHost).mockImplementation(async (options) => {
    launchOptions = options;
    fake = new FakeHost(options.env!['SOUNDOR_DEVTOOLS_SESSION']!, connects);
    await fake.openEditor();
    return fake as unknown as Vst3Host;
  });
}

async function failure(promise: Promise<unknown>, code: DriverErrorCode) {
  const error = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!isDriverError(error, code))
    throw new Error(`Expected a DriverError ${code}, got ${String(error)}`);
  return error;
}

beforeEach(() => {
  vi.mocked(launchHost).mockReset();
  fake = undefined;
  launchOptions = undefined;
});

afterEach(async () => {
  await plugin?.close();
  plugin = undefined;
});

it('opens the editor in a private session and works with its UI', async () => {
  hostLaunches();
  plugin = await launch({
    plugin: 'Plugin.vst3',
    sampleRate: 44_100,
    env: { KEPT: '1', SOUNDOR_DEVTOOLS_SESSION: 'another-session' },
  });

  expect(launchOptions).toMatchObject({
    plugin: 'Plugin.vst3',
    sampleRate: 44_100,
    editor: true,
    env: { KEPT: '1', SOUNDOR_DEVTOOLS_SESSION: plugin.descriptorPath },
  });
  expect(launchOptions).not.toHaveProperty('targetTimeout');
  expect(plugin.host).toBe(fake);
  expect((await plugin.driver.target()).name).toBe('Gain Plugin');
  expect((await plugin.driver.getTree()).nodes.length).toBeGreaterThan(0);
});

it('leaves nothing behind when closed, however many times', async () => {
  hostLaunches();
  plugin = await launch({ plugin: 'Plugin.vst3' });
  const { descriptorPath, driver } = plugin;
  expect(existsSync(descriptorPath)).toBe(true);

  await Promise.all([plugin.close(), plugin.close()]);
  await plugin.close();

  expect(fake!.closes).toHaveBeenCalledOnce();
  expect(driver.connected).toBe(false);
  expect(existsSync(descriptorPath)).toBe(false);
});

it('closes after the host crashed', async () => {
  hostLaunches();
  plugin = await launch({ plugin: 'Plugin.vst3' });
  const { descriptorPath } = plugin;
  await fake!.closeEditor();
  fake!.exit();
  await plugin.close();
  expect(existsSync(descriptorPath)).toBe(false);
});

it('says what to do with a plugin whose UI never connects', async () => {
  hostLaunches({ connects: false });
  const error = await failure(
    launch({ plugin: 'Release.vst3', targetTimeout: 50 }),
    'NO_TARGETS',
  );
  expect(error.message).toContain('"Fake Plugin"');
  expect(error.message).toContain('Debug builds');
  expect(error.message).toContain('launchHost()');
  expect(fake!.closes).toHaveBeenCalledOnce();
  const descriptor = launchOptions!.env!['SOUNDOR_DEVTOOLS_SESSION']!;
  expect(existsSync(descriptor)).toBe(false);
});

it('fails with why when the host exits before the UI connects', async () => {
  hostLaunches({ connects: false });
  const launching = launch({ plugin: 'Crash.vst3', targetTimeout: 5000 });
  await vi.waitFor(() => expect(fake).toBeDefined());
  fake!.exit();
  await expect(launching).rejects.toThrow('signal SIGSEGV');
  const descriptor = launchOptions!.env!['SOUNDOR_DEVTOOLS_SESSION']!;
  expect(existsSync(descriptor)).toBe(false);
});

it('closes the session when the host cannot start', async () => {
  let descriptor = '';
  vi.mocked(launchHost).mockImplementation(async (options) => {
    descriptor = options.env!['SOUNDOR_DEVTOOLS_SESSION']!;
    throw new Error('no such plugin');
  });
  await expect(launch({ plugin: 'Missing.vst3' })).rejects.toThrow(
    'no such plugin',
  );
  expect(descriptor).not.toBe('');
  expect(existsSync(descriptor)).toBe(false);
});

it('cancels waiting for the UI', async () => {
  hostLaunches({ connects: false });
  const controller = new AbortController();
  const launching = launch({
    plugin: 'Plugin.vst3',
    targetTimeout: 5000,
    signal: controller.signal,
  });
  await vi.waitFor(() => expect(fake).toBeDefined());
  controller.abort();
  await failure(launching, 'CANCELLED');
  expect(fake!.closes).toHaveBeenCalledOnce();
});

it('has a new Driver for a new editor, and keeps it for the same one', async () => {
  hostLaunches();
  plugin = await launch({ plugin: 'Plugin.vst3' });
  const first = plugin.driver;

  await plugin.openEditor();
  expect(plugin.driver).toBe(first);
  expect(first.connected).toBe(true);

  await fake!.closeEditor();
  await plugin.openEditor();
  expect(plugin.driver).not.toBe(first);
  expect(first.connected).toBe(false);
  expect((await plugin.driver.getTree()).nodes.length).toBeGreaterThan(0);

  // A call on the old Driver, like a node of the old editor, has no target.
  await failure(first.getTree(), 'DISCONNECTED');
});

it('fails to reopen a plugin whose UI does not connect again', async () => {
  hostLaunches();
  plugin = await launch({ plugin: 'Plugin.vst3', targetTimeout: 50 });
  await fake!.closeEditor();
  fake!.openEditor.mockResolvedValueOnce({ open: true });
  await failure(plugin.openEditor(), 'NO_TARGETS');
});

it('keeps the session out of the package root', async () => {
  const root = await readFile(new URL('./index.ts', import.meta.url), 'utf8');
  const client = await readFile(
    new URL('./driver.ts', import.meta.url),
    'utf8',
  );
  for (const source of [root, client]) {
    expect(source).not.toContain('@soundor/devtools-server');
    expect(source).not.toContain('@soundor/vst3-host');
  }
});

it('keeps its locators working across editors', async () => {
  hostLaunches();
  plugin = await launch({ plugin: 'Plugin.vst3' });
  const gain = plugin.getByText('Gain');
  const byId = plugin.getByDebugId('gain');
  const byRole = plugin.getByRole('adjustable', { name: 'Gain' });
  await gain.waitFor();

  const first = plugin.driver;
  await fake!.closeEditor();
  await plugin.openEditor();
  expect(plugin.driver).not.toBe(first);

  await gain.waitFor();
  await byId.waitFor();
  await byRole.waitFor();
  await gain.click();
  expect((await plugin.screenshot()).width).toBeGreaterThan(0);
});

it('gives the current editor input and the host parameters by title', async () => {
  hostLaunches();
  plugin = await launch({ plugin: 'Plugin.vst3' });
  expect(plugin.pointer).toBe(plugin.driver.pointer);
  expect(plugin.keyboard).toBe(plugin.driver.keyboard);

  const parameter = { get: vi.fn(), set: vi.fn() };
  (fake as unknown as { parameter: unknown }).parameter = vi.fn(
    () => parameter,
  );
  expect(plugin.parameter('Gain')).toBe(parameter);
});
