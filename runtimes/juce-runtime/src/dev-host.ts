/**
 * The VST3 in `soundor dev`: finding `@soundor/vst3-host`, an optional peer the
 * project installs itself, and one host process at a time that keeps the
 * plugin's state from one launch to the next.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { EnvError, type Logger } from '@soundor/runtime-sdk';

import type { DevLaunch, ResolvedJuceOptions } from './options';

export const HOST_PACKAGE = '@soundor/vst3-host';

/** What this runtime uses of the host. */
export type HostModule = Pick<
  typeof import('@soundor/vst3-host'),
  'launchHost' | 'prepareHost' | 'resolveHost'
>;
type Host = Awaited<ReturnType<HostModule['launchHost']>>;

export type Vst3HostAvailability =
  | { readonly status: 'absent' }
  | { readonly status: 'unsupported'; readonly reason: string }
  | { readonly status: 'available'; readonly module: HostModule };

function errorCode(error: unknown): unknown {
  return (error as { code?: unknown } | null)?.code;
}

/**
 * The host as the project has it: installing it is the project's choice, so it
 * is looked for from the project, in its `node_modules` and those above, and
 * not as Node would. From this package that would find this workspace's own
 * devDependency, and a `require` anywhere reads `NODE_PATH`, where pnpm's scripts
 * put every package it hoisted. A package that is there and fails to load is an
 * error, not an absent one.
 */
export async function loadHostModule(
  root: string,
): Promise<HostModule | undefined> {
  const manifest = findInstalledManifest(root);
  if (manifest === undefined) return undefined;
  // Its entry is ES only; the path is the one `import` would have selected.
  const { exports } = JSON.parse(readFileSync(manifest, 'utf8')) as {
    exports: { '.': { import: string } };
  };
  return (await import(
    pathToFileURL(join(dirname(manifest), exports['.'].import)).href
  )) as HostModule;
}

function findInstalledManifest(root: string): string | undefined {
  for (let dir = root; ; dir = dirname(dir)) {
    const manifest = join(dir, 'node_modules', HOST_PACKAGE, 'package.json');
    if (existsSync(manifest)) return realpathSync(manifest);
    if (dirname(dir) === dir) return undefined;
  }
}

/** A platform the host has no executable for is as good as not installing it. */
export async function findVst3Host(
  root: string,
  load: (root: string) => Promise<HostModule | undefined>,
): Promise<Vst3HostAvailability> {
  const module = await load(root);
  if (module === undefined) return { status: 'absent' };
  try {
    module.resolveHost();
  } catch (error) {
    if (errorCode(error) === 'unsupported-platform')
      return { status: 'unsupported', reason: (error as Error).message };
    // Anything else surfaces when the host is needed: a source checkout, for
    // one, builds it then.
  }
  return { status: 'available', module };
}

/** What `soundor dev` opens by itself once the plugin is built. */
export function chooseDevLaunch(
  options: Pick<ResolvedJuceOptions, 'formats' | 'devLaunch'>,
  host: Vst3HostAvailability,
): DevLaunch {
  const { formats, devLaunch } = options;
  if (devLaunch === 'vst3' && host.status !== 'available')
    throw new EnvError(
      host.status === 'unsupported'
        ? `juceRuntime({ dev: { launch: "vst3" } }): ${host.reason}`
        : `juceRuntime({ dev: { launch: "vst3" } }) needs ${HOST_PACKAGE}: add it to the project's devDependencies.`,
    );
  if (devLaunch !== undefined) return devLaunch;
  if (formats.includes('vst3') && host.status === 'available') return 'vst3';
  return formats.includes('standalone') ? 'standalone' : false;
}

/**
 * The executable to run. `resolveHost()` never builds or downloads, so a source
 * checkout whose selection is missing or stale goes through `prepareHost()`
 * (also what an installed package answers with the same error).
 */
export async function prepareHostExecutable(
  module: HostModule,
  log: (message: string) => void,
): Promise<string> {
  try {
    return module.resolveHost().executable;
  } catch (error) {
    if (errorCode(error) !== 'executable-not-found') throw error;
  }
  return (await module.prepareHost({ log })).executable;
}

export interface DevVst3HostOptions {
  readonly module: HostModule;
  /** The `.vst3` bundle. */
  readonly plugin: string;
  /** Where the plugin's state stays between launches. */
  readonly stateFile: string;
  readonly logger: Logger;
  readonly signal: AbortSignal;
  /** What the host runs with; undefined when it cannot open a window. */
  readonly environment: () => Record<string, string | undefined> | undefined;
}

const SAVE_TIMEOUT_MS = 5000;

/**
 * The plugin in the VST3 host, for the length of a `soundor dev`. Unlike the
 * Standalone it belongs to the session: it ends with it, and there is one at a
 * time, as one state file would not serve several. Everything runs in turn.
 */
export class DevVst3Host {
  readonly #options: DevVst3HostOptions;
  #host: Host | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  #closed = false;

  constructor(options: DevVst3HostOptions) {
    this.#options = options;
  }

  /** Opens the plugin, saving and closing the one that is open. */
  launch(): Promise<void> {
    return this.#enqueue(async () => {
      if (this.#closed) return;
      await this.#stop();
      await this.#start();
    });
  }

  /** Saves the plugin's state and ends the host, for good. */
  close(): Promise<void> {
    this.#closed = true;
    return this.#enqueue(() => this.#stop());
  }

  #enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.#queue.then(task);
    this.#queue = next.catch(() => {});
    return next;
  }

  async #start(): Promise<void> {
    const { module, plugin, logger, signal, environment } = this.#options;
    const env = environment();
    if (env === undefined) return;
    let host: Host;
    try {
      await prepareHostExecutable(module, (message) => logger.info(message));
      host = await this.#launchRestored(env);
    } catch (error) {
      if (!signal.aborted)
        logger.warn(
          `The VST3 host could not open the plugin; v tries again.\n${(error as Error).message}`,
        );
      return;
    }
    this.#host = host;
    host.once('editorClosed', () => {
      void this.#enqueue(async () => {
        if (this.#host !== host) return;
        await this.#stop();
        logger.info('The VST3 host closed with its window; v opens it again.');
      });
    });
    void host.exited.then(() => {
      if (this.#host !== host) return;
      this.#host = undefined;
      logger.warn('The VST3 host exited; v launches it again.');
    });
    logger.info(`Opened the VST3 in the host: ${plugin}`);
  }

  /** A state the plugin refuses, or dies of, is dropped for a clean instance. */
  async #launchRestored(
    env: Record<string, string | undefined>,
  ): Promise<Host> {
    const { logger, stateFile } = this.#options;
    const host = await this.#launch(env);
    const state = await this.#readState();
    if (state === undefined) return host;
    try {
      await host.setState(state);
      logger.info(`Restored the plugin's state from ${stateFile}`);
      return host;
    } catch (error) {
      logger.warn(
        `The plugin did not accept its saved state, so it starts from its defaults.\n${(error as Error).message}`,
      );
      await host.close();
      await rm(stateFile, { force: true });
      return this.#launch(env);
    }
  }

  #launch(env: Record<string, string | undefined>): Promise<Host> {
    const { module, plugin, logger, signal } = this.#options;
    return module.launchHost({
      plugin,
      editor: true,
      // As the user's host settings say.
      presentation: null,
      env,
      // Ctrl+C is for `soundor dev`, which saves the state and then closes it.
      detached: true,
      signal,
      // The UI's log is already in the terminal, from its log file.
      onLog: (line) => {
        if (!line.startsWith('[soundor] ')) logger.info(line);
      },
    });
  }

  async #stop(): Promise<void> {
    const host = this.#host;
    if (host === undefined) return;
    this.#host = undefined;
    try {
      await this.#saveState(await host.getState({ timeout: SAVE_TIMEOUT_MS }));
    } catch (error) {
      this.#options.logger.warn(
        `Could not save the plugin's state.\n${(error as Error).message}`,
      );
    }
    await host.close();
  }

  async #readState(): Promise<
    Awaited<ReturnType<Host['getState']>> | undefined
  > {
    const { logger, stateFile } = this.#options;
    let text: string;
    try {
      text = await readFile(stateFile, 'utf8');
    } catch {
      return undefined;
    }
    try {
      const saved = JSON.parse(text) as Record<string, unknown>;
      if (
        typeof saved['component'] !== 'string' ||
        typeof saved['controller'] !== 'string'
      )
        throw new Error('it is not a saved state');
      return {
        component: Buffer.from(saved['component'], 'base64'),
        controller: Buffer.from(saved['controller'], 'base64'),
      };
    } catch (error) {
      logger.warn(
        `Ignoring ${stateFile}: ${(error as Error).message}. The plugin starts from its defaults.`,
      );
      await rm(stateFile, { force: true });
      return undefined;
    }
  }

  async #saveState(
    state: Awaited<ReturnType<Host['getState']>>,
  ): Promise<void> {
    const { stateFile } = this.#options;
    await mkdir(dirname(stateFile), { recursive: true });
    const partial = `${stateFile}.part`;
    await writeFile(
      partial,
      JSON.stringify({
        component: Buffer.from(state.component).toString('base64'),
        controller: Buffer.from(state.controller).toString('base64'),
      }),
    );
    await rename(partial, stateFile);
  }
}
