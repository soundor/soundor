import { startDevToolsServer } from '@soundor/devtools-server';
import {
  launchHost,
  type EditorInfo,
  type LaunchOptions,
  type Presentation,
  type RequestOptions,
  type Vst3Host,
} from '@soundor/vst3-host';

import { connect, type Driver } from './driver';
import { DriverError, isDriverError } from './errors';
import { DESCRIPTOR_ENV } from './session';

export interface Vst3LaunchOptions extends Omit<LaunchOptions, 'editor'> {
  /** Milliseconds for the plugin's UI to connect once its editor is open
      (10 000 by default). */
  targetTimeout?: number;
  /** Milliseconds to wait for each Driver command (10 000 by default). */
  commandTimeout?: number;
}

interface Attachment {
  host: Vst3Host;
  descriptorPath: string;
  targetTimeout: number;
  commandTimeout: number | undefined;
  signal?: AbortSignal | undefined;
}

/** A Driver of the one editor the session holds, once it has connected. */
async function attach({
  host,
  descriptorPath,
  targetTimeout,
  commandTimeout,
  signal,
}: Attachment): Promise<Driver> {
  const call = signal ? { signal } : {};
  const driver = await connect({
    descriptorPath,
    ...(commandTimeout === undefined ? {} : { timeout: commandTimeout }),
    ...call,
  });
  // A host that ended fails its requests with why, and what it last logged.
  const exited = host.exited.then(async (): Promise<never> => {
    await host.getEditor();
    throw new DriverError('TARGET_DISCONNECTED', 'The VST3 host exited');
  });
  try {
    await Promise.race([
      driver.waitForTarget({ timeout: targetTimeout, ...call }),
      exited,
    ]);
    return driver;
  } catch (error) {
    await driver.disconnect();
    if (!isDriverError(error, 'TIMEOUT')) throw error;
    throw new DriverError(
      'NO_TARGETS',
      `The editor of "${host.info.name}" opened, but no Soundor UI connected within ${targetTimeout} ms: only Debug builds of Soundor plugins have DevTools (soundor dev builds them). For any other plugin, use launchHost() from @soundor/vst3-host`,
      { cause: error },
    );
  }
}

/**
 * Starts a private DevTools session, loads a Debug build of a Soundor plugin
 * in the VST3 host, opens its editor, and resolves once the Driver can work
 * with it. Audio and parameters go through `host`, the UI through `driver`.
 */
export async function launch(options: Vst3LaunchOptions): Promise<Vst3Plugin> {
  const { targetTimeout = 10000, commandTimeout, ...hostOptions } = options;
  const server = await startDevToolsServer({
    projectRoot: options.cwd ?? process.cwd(),
    port: 0,
  });
  let host: Vst3Host | undefined;
  try {
    host = await launchHost({
      ...hostOptions,
      editor: true,
      env: { ...options.env, [DESCRIPTOR_ENV]: server.descriptorPath },
    });
    const attachment = {
      host,
      descriptorPath: server.descriptorPath,
      targetTimeout,
      commandTimeout,
    };
    const driver = await attach({ ...attachment, signal: options.signal });
    return new Vst3Plugin(attachment, driver, () => server.close());
  } catch (error) {
    await host?.close();
    await server.close();
    throw error;
  }
}

/** A plugin running in its own VST3 host and DevTools session. */
export class Vst3Plugin {
  readonly #attachment: Attachment;
  readonly #closeSession: () => Promise<void>;
  #driver: Driver;
  // One attachment at a time, and none left behind by close().
  #opening: Promise<unknown> = Promise.resolve();
  #closing: Promise<void> | undefined;

  /** @internal Use {@link launch}. */
  constructor(
    attachment: Attachment,
    driver: Driver,
    closeSession: () => Promise<void>,
  ) {
    this.#attachment = attachment;
    this.#driver = driver;
    this.#closeSession = closeSession;
  }

  /** The host process: audio, parameters, state, transport, editor size. */
  get host(): Vst3Host {
    return this.#attachment.host;
  }

  /**
   * The Driver of the current editor. An editor that closes takes its
   * Driver's target with it, and calls fail with `TARGET_DISCONNECTED`:
   * {@link openEditor} makes the next one, so read this again after it.
   */
  get driver(): Driver {
    return this.#driver;
  }

  /** The private session's descriptor, for `soundor driver --descriptor`. */
  get descriptorPath(): string {
    return this.#attachment.descriptorPath;
  }

  /**
   * Opens the editor if it closed (`host.closeEditor()`, `host.recreate()`,
   * the user closing the window) or shows it in another presentation, and
   * connects a new {@link driver} if that made a new editor.
   */
  openEditor(
    options: RequestOptions & {
      scale?: number;
      presentation?: Presentation;
    } = {},
  ): Promise<EditorInfo> {
    const run = async () => {
      const previous = this.#driver;
      const info = await this.host.openEditor(options);
      // An editor unregisters before closing, so this is the session's state.
      const target = await previous.target().catch(() => undefined);
      const targets = await previous.targets();
      if (target && targets.some(({ id }) => id === target.id)) return info;
      this.#driver = await attach({
        ...this.#attachment,
        signal: options.signal,
      });
      await previous.disconnect();
      return info;
    };
    const opened = this.#opening.then(run, run);
    this.#opening = opened.catch(() => {});
    return opened;
  }

  /**
   * Closes the Driver, the host and the session, whose descriptor goes with
   * it. Idempotent, and safe after the host has crashed.
   */
  close(): Promise<void> {
    this.#closing ??= (async () => {
      await this.host.close();
      await this.#opening;
      await this.#driver.disconnect();
      await this.#closeSession();
    })();
    return this.#closing;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}
