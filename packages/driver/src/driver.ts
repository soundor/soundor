import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type {
  DebugMethod,
  DebugNode,
  DebugTarget,
  DebugTree,
  HitTest,
  MethodResults,
  NodeRef,
  Params,
} from '@soundor/devtools-protocol';

import { DriverError, isDriverError } from './errors';
import { Keyboard, Pointer, type InputHost } from './input';
import { Locator, type LocatorHost } from './locator';
import {
  BROWSER_KEY_ENV,
  DESCRIPTOR_ENV,
  parseBrowserKey,
  parseEndpoint,
  readDescriptor,
  type SessionCredentials,
} from './session';
import { Connection, type CallOptions } from './transport';

/** A PNG capture of what the engine renders. */
export interface Screenshot {
  /** The PNG file's bytes. */
  data: Uint8Array;
  /** Its size in device pixels: logical pixels times `scale`. */
  width: number;
  height: number;
  /** Device pixels per logical pixel, as the view was shown. */
  scale: number;
  format: 'png';
  /** Where it was saved, when `path` was given. */
  path?: string;
}

export interface ScreenshotOptions extends CallOptions {
  /** Saves the PNG there too (overwriting a file there). */
  path?: string;
}

export interface ConnectOptions {
  /**
   * The protected session descriptor `soundor dev` writes (its path is
   * printed as "DevTools session file"). Defaults to
   * `$SOUNDOR_DEVTOOLS_SESSION` when no endpoint is given.
   */
  descriptorPath?: string;
  /** The session's endpoint, `http://127.0.0.1:<port>`, instead of a descriptor. */
  endpoint?: string;
  /**
   * The browser key for `endpoint`: the descriptor's `browserKey`. Defaults
   * to `$SOUNDOR_DEVTOOLS_BROWSER_KEY`.
   */
  browserKey?: string;
  /** The instance to work with, by its exact target ID. */
  targetId?: string;
  /** The instance to work with, by its plugin name, which must be unique. */
  targetName?: string;
  /** Milliseconds to wait for each command (10 000 by default). */
  timeout?: number;
  /** Milliseconds to wait for the connection (10 000 by default). */
  connectTimeout?: number;
  /** Cancels connecting. */
  signal?: AbortSignal;
}

/** Where the credentials come from: options, then the environment. */
async function credentials(
  options: ConnectOptions,
): Promise<SessionCredentials> {
  if (options.descriptorPath !== undefined && options.endpoint !== undefined)
    throw new DriverError(
      'INVALID_OPTIONS',
      'Pass either descriptorPath or endpoint, not both',
    );
  if (options.endpoint !== undefined) {
    const browserKey = options.browserKey ?? process.env[BROWSER_KEY_ENV];
    if (!browserKey)
      throw new DriverError(
        'INVALID_OPTIONS',
        `An endpoint needs the session's browser key: pass browserKey or set ${BROWSER_KEY_ENV}`,
      );
    return {
      endpoint: parseEndpoint(options.endpoint),
      browserKey: parseBrowserKey(browserKey),
    };
  }
  if (options.browserKey !== undefined)
    throw new DriverError(
      'INVALID_OPTIONS',
      'browserKey goes with endpoint; a descriptor has its own',
    );
  const path = options.descriptorPath ?? process.env[DESCRIPTOR_ENV];
  if (!path)
    throw new DriverError(
      'INVALID_OPTIONS',
      `Name the DevTools session: pass descriptorPath (soundor dev prints "DevTools session file"), set ${DESCRIPTOR_ENV}, or pass endpoint and browserKey`,
    );
  return readDescriptor(path);
}

// Selection is the Driver's own; connect() selects the requested target.
let selectTarget: (
  driver: Driver,
  candidates: DebugTarget[],
  wanted: string,
) => DebugTarget;

function label(target: DebugTarget): string {
  return `"${target.name}" (${target.id})`;
}

/**
 * Connects to a running DevTools session as a control client: the same
 * authenticated transport as the DevTools dashboard, never as a runtime.
 */
export async function connect(options: ConnectOptions = {}): Promise<Driver> {
  if (options.targetId !== undefined && options.targetName !== undefined)
    throw new DriverError(
      'INVALID_OPTIONS',
      'Pass either targetId or targetName, not both',
    );
  for (const key of ['timeout', 'connectTimeout'] as const) {
    const value = options[key];
    if (value !== undefined && !(Number.isFinite(value) && value > 0))
      throw new DriverError(
        'INVALID_OPTIONS',
        `${key} must be a positive number of milliseconds`,
      );
  }
  const connection = await Connection.open(await credentials(options), {
    timeout: options.connectTimeout ?? 10000,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const driver = new Driver(connection, options.timeout ?? 10000);
  try {
    // An explicit selection fails now, not at the first command.
    if (options.targetId !== undefined || options.targetName !== undefined)
      selectTarget(
        driver,
        (await driver.targets()).filter((target) =>
          options.targetId !== undefined
            ? target.id === options.targetId
            : target.name === options.targetName,
        ),
        options.targetId !== undefined
          ? `ID ${options.targetId}`
          : `name "${options.targetName}"`,
      );
  } catch (error) {
    await driver.disconnect();
    throw error;
  }
  return driver;
}

/**
 * A connection to one DevTools session, working with one of its instances
 * (the target). Other clients (dashboard tabs, other Drivers) work beside
 * it: each has its own synthetic pointer and keys, as two mice would.
 */
export class Driver {
  readonly #connection: Connection;
  readonly #timeout: number;
  #target: DebugTarget | undefined;
  #targetLost = false;
  readonly #locatorHost: LocatorHost;
  // This client's input goes one command at a time, in order.
  #interactive: Promise<unknown> = Promise.resolve();
  /** This client's synthetic pointer on the target. */
  readonly pointer: Pointer;
  /** This client's synthetic keyboard on the target (focus is the view's). */
  readonly keyboard: Keyboard;

  /** @internal Use {@link connect}. */
  constructor(connection: Connection, timeout: number) {
    this.#connection = connection;
    this.#timeout = timeout;
    connection.onTargets((targets) => this.#targetsChanged(targets));
    const input: InputHost = {
      send: (method, params, options) =>
        this.#interact(method, params, options),
    };
    this.pointer = new Pointer(input);
    this.keyboard = new Keyboard(input);
    this.#locatorHost = {
      pointer: this.pointer,
      keyboard: this.keyboard,
      timeout: () => this.#timeout,
      hitTest: (x, y, options) => this.hitTest(x, y, options),
      focus: (ref, options) => this.#focus(ref, options),
      capture: (ref, options) => this.#capture(ref, options),
      getTree: (options) => this.getTree(options),
      getNode: (ref, options) => this.getNode(ref, options),
      getLayout: (ref, options) => this.getLayout(ref, options),
      getStyles: (ref, options) => this.getStyles(ref, options),
      getAccessibility: (ref, options) => this.getAccessibility(ref, options),
    };
  }

  /** The project directory of the development session. */
  get project(): string {
    return this.#connection.project;
  }

  /** Whether the connection to the server is open. */
  get connected(): boolean {
    return !this.#connection.closed;
  }

  /**
   * The server announces target changes in order; a `Runtime.getTargets`
   * reply can be older than an announcement, so only announcements (and
   * TARGET_GONE) say the target went.
   */
  #targetsChanged(targets: DebugTarget[], announced = true): void {
    if (!this.#target) return;
    const current = targets.find((target) => target.id === this.#target!.id);
    // Never followed to another instance, whatever its name.
    if (!current) this.#targetLost ||= announced;
    else if (announced || current.generation >= this.#target.generation) {
      // A reload: the pointer is the new view's, with no position yet.
      if (current.generation !== this.#target.generation) this.pointer.forget();
      this.#target = current;
    }
  }

  static {
    selectTarget = (driver, candidates, wanted) =>
      driver.#select(candidates, wanted);
  }

  /** Binds the one target of `candidates`, for good. */
  #select(candidates: DebugTarget[], wanted: string): DebugTarget {
    if (candidates.length === 0)
      throw new DriverError(
        'TARGET_NOT_FOUND',
        `No running instance has the ${wanted}; list them with targets()`,
      );
    if (candidates.length > 1)
      throw new DriverError(
        'AMBIGUOUS_TARGET',
        `${candidates.length} running instances have the ${wanted} (${candidates.map(label).join(', ')}); select one by targetId`,
      );
    this.#target = candidates[0]!;
    this.#targetLost = false;
    return this.#target;
  }

  /** The running instances of the session, now. */
  async targets(options?: CallOptions): Promise<DebugTarget[]> {
    const targets = await this.#connection.request(
      'Runtime.getTargets',
      {},
      undefined,
      this.#options(options),
    );
    this.#targetsChanged(targets, false);
    return targets;
  }

  /**
   * The instance this Driver works with. Without a selection it is the only
   * running instance; with several, select one when connecting.
   */
  async target(options?: CallOptions): Promise<DebugTarget> {
    if (this.#target) return this.#current();
    const targets = await this.targets(options);
    if (this.#target) return this.#current();
    if (targets.length === 0)
      throw new DriverError(
        'NO_TARGETS',
        'No Soundor instance is connected to this DevTools session: open the plugin (soundor dev starts it)',
      );
    if (targets.length > 1)
      throw new DriverError(
        'AMBIGUOUS_TARGET',
        `${targets.length} instances are running (${targets.map(label).join(', ')}); select one with targetId`,
      );
    return this.#select(targets, 'only instance');
  }

  /**
   * Waits for an instance to connect (when none is selected) and selects it,
   * as {@link target} does.
   */
  async waitForTarget(options?: CallOptions): Promise<DebugTarget> {
    if (this.#target) return this.#current();
    const { timeout, signal } = this.#options(options);
    return new Promise<DebugTarget>((resolve, reject) => {
      let done = false;
      const finish = (error?: unknown, target?: DebugTarget) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        stopTargets();
        stopClose();
        if (error) reject(error);
        else resolve(target!);
      };
      const check = (targets: DebugTarget[]) => {
        if (targets.length === 0) return;
        try {
          finish(undefined, this.#select(targets, 'only instance'));
        } catch (error) {
          finish(
            isDriverError(error, 'AMBIGUOUS_TARGET')
              ? new DriverError(
                  'AMBIGUOUS_TARGET',
                  `${targets.length} instances are running (${targets.map(label).join(', ')}); select one with targetId`,
                )
              : error,
          );
        }
      };
      const timer = setTimeout(
        () =>
          finish(
            new DriverError(
              'TIMEOUT',
              `No Soundor instance connected within ${timeout} ms`,
            ),
          ),
        timeout,
      );
      const onAbort = () =>
        finish(
          new DriverError('CANCELLED', 'Waiting for a target was cancelled'),
        );
      signal?.addEventListener('abort', onAbort, { once: true });
      const stopTargets = this.#connection.onTargets(check);
      const stopClose = this.#connection.onClose((error) => finish(error));
      if (signal?.aborted) onAbort();
      else
        void this.targets({ timeout, ...(signal ? { signal } : {}) }).then(
          check,
          (error: unknown) => finish(error),
        );
    });
  }

  #current(): DebugTarget {
    if (this.#connection.closed)
      throw new DriverError('DISCONNECTED', 'The Driver is disconnected');
    if (this.#targetLost)
      throw new DriverError(
        'TARGET_DISCONNECTED',
        `The instance ${label(this.#target!)} disconnected; connect again to work with another`,
      );
    return this.#target!;
  }

  #options(options: CallOptions | undefined): {
    timeout: number;
    signal?: AbortSignal;
  } {
    return {
      timeout: options?.timeout ?? this.#timeout,
      ...(options?.signal ? { signal: options.signal } : {}),
    };
  }

  /** A request to the selected target, with its errors made precise. */
  async #request<M extends DebugMethod>(
    method: M,
    params: Params<M>,
    options?: CallOptions,
  ): Promise<MethodResults[M]> {
    const target = await this.target(options);
    const generation = target.generation;
    try {
      return await this.#connection.request(
        method,
        params,
        target.id,
        this.#options(options),
      );
    } catch (error) {
      if (isDriverError(error, 'TARGET_DISCONNECTED')) {
        this.#targetLost = true;
        this.#current();
      }
      if (
        isDriverError(error, 'STALE_NODE') &&
        this.#target!.generation !== generation
      )
        throw new DriverError(
          'GENERATION_CHANGED',
          `${method}: the instance reloaded (generation ${generation} → ${this.#target!.generation}); query it again`,
        );
      throw error;
    }
  }

  #checkRef(ref: NodeRef): void {
    const generation = this.#current().generation;
    if (ref.generation !== generation)
      throw new DriverError(
        'STALE_NODE',
        `Node ${ref.id} is from generation ${ref.generation}, but the instance reloaded (generation ${generation}); find it again`,
      );
  }

  /** A snapshot of the target's whole native UI tree (at most 5000 nodes). */
  async getTree(options?: CallOptions): Promise<DebugTree> {
    return this.#request('UI.getTree', {}, options);
  }

  /** A node's details: properties, layout, styles, presentation, accessibility. */
  async getNode(ref: NodeRef, options?: CallOptions): Promise<DebugNode> {
    await this.target(options);
    this.#checkRef(ref);
    return this.#request('UI.getNode', { node: ref }, options);
  }

  /** A node's layout: its frame, bounds, content box, scroll offset, scale. */
  async getLayout(
    ref: NodeRef,
    options?: CallOptions,
  ): Promise<Record<string, unknown>> {
    await this.target(options);
    this.#checkRef(ref);
    return this.#request('UI.getLayout', { node: ref }, options);
  }

  /** A node's base styles and presented (animated) styles. */
  async getStyles(
    ref: NodeRef,
    options?: CallOptions,
  ): Promise<Record<string, unknown>> {
    await this.target(options);
    this.#checkRef(ref);
    return this.#request('UI.getStyles', { node: ref }, options);
  }

  /** What a node is to assistive technology. */
  async getAccessibility(
    ref: NodeRef,
    options?: CallOptions,
  ): Promise<Record<string, unknown>> {
    await this.target(options);
    this.#checkRef(ref);
    return this.#request('UI.getAccessibility', { node: ref }, options);
  }

  /** Sends one input command, after the previous one. */
  #interact<M extends DebugMethod>(
    method: M,
    params: Params<M>,
    options?: CallOptions,
  ): Promise<MethodResults[M]> {
    const run = async () => {
      if (options?.signal?.aborted)
        throw new DriverError('CANCELLED', `${method} was cancelled`);
      return this.#request(method, params, options);
    };
    const result = this.#interactive.then(run, run);
    this.#interactive = result.catch(() => {});
    return result;
  }

  /**
   * What is at a point of the view (logical pixels): the deepest node input
   * there reaches, and its ancestors from a root. Sends no input.
   */
  async hitTest(x: number, y: number, options?: CallOptions): Promise<HitTest> {
    return this.#request('UI.hitTest', { x, y }, options);
  }

  async #focus(ref: NodeRef, options?: CallOptions): Promise<void> {
    await this.target(options);
    this.#checkRef(ref);
    await this.#interact('Input.focus', { node: ref }, options);
  }

  /**
   * Captures the target's view as the engine renders it, as PNG: its
   * renderer draws the current UI (not an OS screenshot), at the display's
   * scale. Needs the `capture` capability.
   */
  async screenshot(options: ScreenshotOptions = {}): Promise<Screenshot> {
    return this.#capture(undefined, options);
  }

  async #capture(
    node: NodeRef | undefined,
    options: ScreenshotOptions,
  ): Promise<Screenshot> {
    const target = await this.target(options);
    if (!target.capabilities.includes('capture'))
      throw new DriverError(
        'MISSING_CAPABILITY',
        `${label(target)} cannot capture its view (no capture capability)`,
      );
    if (node) this.#checkRef(node);
    const capture = await this.#request(
      'Capture.screenshot',
      node ? { node } : {},
      options,
    );
    const data = await this.#connection.readCapture(
      capture.id,
      this.#options(options),
    );
    if (data.length !== capture.bytes)
      throw new DriverError(
        'SCREENSHOT_UNAVAILABLE',
        'The capture arrived incomplete',
      );
    const screenshot: Screenshot = {
      data,
      width: capture.width,
      height: capture.height,
      scale: capture.scale,
      format: capture.format,
    };
    if (options.path === undefined) return screenshot;
    const path = resolve(options.path);
    try {
      await writeFile(path, data);
    } catch (error) {
      throw new DriverError(
        'INVALID_OPTIONS',
        `Cannot save the screenshot to ${path} (${(error as NodeJS.ErrnoException).code ?? 'error'})`,
      );
    }
    return { ...screenshot, path };
  }

  /** The node with this `debugId` prop. */
  getByDebugId(debugId: string): Locator {
    return new Locator(this.#locatorHost, { debugId });
  }

  /** The node exposed to assistive technology with this role (and name). */
  getByRole(
    role: string,
    options: { name?: string; exact?: boolean } = {},
  ): Locator {
    return new Locator(this.#locatorHost, { role, ...options });
  }

  /** The text or input node showing this text. */
  getByText(text: string, options: { exact?: boolean } = {}): Locator {
    return new Locator(this.#locatorHost, { text, ...options });
  }

  /**
   * Closes the connection. Idempotent; pending calls fail with
   * DISCONNECTED, and the instance releases this client's synthetic input
   * (no button or key stays down) and removes its highlight.
   */
  async disconnect(): Promise<void> {
    await this.#connection.close();
  }
}
