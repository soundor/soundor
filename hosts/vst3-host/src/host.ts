import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { endianness } from 'node:os';

import { Vst3HostError } from './errors.ts';
import {
  DEFAULT_MAX_PAYLOAD_BYTES,
  type Frame,
  FrameDecoder,
  PROTOCOL_VERSION,
  encodeFrame,
} from './protocol.ts';
import { resolveHost } from './resolve.ts';
import type {
  EditorInfo,
  HostEvents,
  LatencyInfo,
  ParameterInfo,
  ParameterValue,
  PluginInfo,
  PluginState,
  ProcessRequest,
  ProcessResult,
  ProcessingSetup,
  RequestOptions,
} from './types.ts';

export interface LaunchOptions extends ProcessingSetup {
  /** The .vst3 bundle to load, by path; it need not be installed. */
  plugin: string;
  /** The audio processor class, when the bundle has several. */
  className?: string;
  classId?: string;
  /** UI mode: open the plugin's editor in a native window. Default false
      (headless: no window, no display needed). */
  editor?: boolean;
  /** The editor's content scale (Windows, Linux). Default: the window's. */
  scale?: number;
  /** The executable. Default: resolveHost(). */
  executable?: string;
  /** Added to (or, with inheritEnv: false, instead of) process.env.
      SOUNDOR_DEVTOOLS_SESSION reaches the plugin this way. */
  env?: Record<string, string | undefined>;
  inheritEnv?: boolean;
  cwd?: string;
  /** Milliseconds for the host to start and load the plugin. Default 30000. */
  startTimeout?: number;
  /** Default timeout of each request, in milliseconds. Default 60000. */
  requestTimeout?: number;
  /** The largest frame either side accepts. Default 256 MiB. */
  maxPayloadBytes?: number;
  /** Each line the host or the plugin writes to stderr. */
  onLog?: (line: string) => void;
  signal?: AbortSignal;
}

interface Pending {
  id: number;
  method: string;
  params: unknown;
  payload: Uint8Array | undefined;
  timeout: number;
  signal: AbortSignal | undefined;
  resolve: (frame: { result: unknown; payload: Buffer }) => void;
  reject: (error: Error) => void;
  /** Answered or abandoned: its response, when it comes, is dropped. */
  settled: boolean;
  timer?: NodeJS.Timeout;
  onAbort?: () => void;
}

const live = new Set<ChildProcess>();
let exitHookInstalled = false;
// No host outlives this process, whatever ends it.
function track(child: ChildProcess): void {
  live.add(child);
  child.once('exit', () => live.delete(child));
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.once('exit', () => {
      for (const host of live) host.kill('SIGKILL');
    });
  }
}

const LITTLE_ENDIAN = endianness() === 'LE';

/** Starts a host process, loads the plugin and resolves once it is ready. */
export async function launchHost(options: LaunchOptions): Promise<Vst3Host> {
  if (!LITTLE_ENDIAN)
    throw new Vst3HostError(
      'unsupported-platform',
      'the host protocol carries little-endian audio',
    );
  const executable = options.executable ?? resolveHost().executable;
  const maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  const args = [
    options.editor ? '--ui' : '--headless',
    '--max-payload',
    String(maxPayloadBytes),
  ];
  const env: Record<string, string | undefined> = {
    ...(options.inheritEnv === false ? {} : process.env),
    ...options.env,
  };
  for (const key of Object.keys(env))
    if (env[key] === undefined) delete env[key];

  const child = spawn(executable, args, {
    cwd: options.cwd,
    env: env as NodeJS.ProcessEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  track(child);
  const host = new Vst3Host(child, {
    maxPayloadBytes,
    requestTimeout: options.requestTimeout ?? 60_000,
    onLog: options.onLog,
    executable,
  });
  const startTimeout = options.startTimeout ?? 30_000;
  try {
    await host.ready(startTimeout, options.signal);
    await host.load(options, startTimeout, options.signal);
    return host;
  } catch (error) {
    await host.close();
    throw error;
  }
}

interface HostOptions {
  maxPayloadBytes: number;
  requestTimeout: number;
  onLog: ((line: string) => void) | undefined;
  executable: string;
}

export interface HostIdentity {
  protocol: number;
  version: string;
  sdkVersion: string;
  platform: string;
  arch: string;
  mode: 'ui' | 'headless';
  maxPayloadBytes: number;
}

/** A running host with one plugin loaded. Requests run one at a time, in
    the order they are made. */
export class Vst3Host {
  #child: ChildProcess;
  #options: HostOptions;
  #events = new EventEmitter();
  #decoder: FrameDecoder;
  #queue: Pending[] = [];
  #current: Pending | undefined;
  #nextId = 1;
  #stderr = '';
  #partialLine = '';
  #exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  #exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  #failure: Vst3HostError | undefined;
  #closing:
    | Promise<{ code: number | null; signal: NodeJS.Signals | null }>
    | undefined;
  #closeRequested = false;
  #hello: ((identity: HostIdentity) => void) | undefined;
  #identity: HostIdentity | undefined;
  #info: PluginInfo | undefined;

  /** @internal Use launchHost(). */
  constructor(child: ChildProcess, options: HostOptions) {
    this.#child = child;
    this.#options = options;
    this.#decoder = new FrameDecoder(options.maxPayloadBytes);
    this.#events.setMaxListeners(0);
    this.#exited = new Promise((resolve) => {
      child.once('exit', (code, signal) => {
        this.#exit = { code, signal };
        this.#fail(
          this.#closeRequested
            ? new Vst3HostError('closed', 'the VST3 host was closed')
            : new Vst3HostError(
                'host-exited',
                `the VST3 host exited (${signal ? `signal ${signal}` : `code ${code}`})${this.#stderrTail()}`,
                { code, signal, stderr: this.#stderr.slice(-4096) },
              ),
        );
        this.#events.emit('exit', { code, signal });
        resolve({ code, signal });
      });
      // Not started at all: there will be no 'exit'.
      child.once('error', (error) => {
        if (child.pid !== undefined) return;
        this.#fail(
          new Vst3HostError(
            'executable-not-found',
            `the VST3 host could not be started from ${options.executable}: ${error.message}`,
            { executable: options.executable },
            { cause: error },
          ),
        );
        this.#exit = { code: null, signal: null };
        resolve(this.#exit);
      });
    });
    child.stdout!.on('data', (chunk: Buffer) => {
      let frames: Frame[];
      try {
        frames = this.#decoder.push(chunk);
      } catch (error) {
        this.#fail(
          new Vst3HostError('protocol-error', (error as Error).message),
        );
        child.kill('SIGKILL');
        return;
      }
      for (const frame of frames) this.#receive(frame);
    });
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (text: string) => {
      this.#stderr = (this.#stderr + text).slice(-65536);
      if (!this.#options.onLog) return;
      const lines = (this.#partialLine + text).split(/\r?\n/);
      this.#partialLine = lines.pop() ?? '';
      for (const line of lines) this.#options.onLog(line);
    });
    // A host that is gone cannot read: its requests fail through #fail.
    child.stdin!.on('error', () => {});
  }

  /** The host process's id. */
  get pid(): number | undefined {
    return this.#child.pid;
  }

  /** What the host reported when it started. */
  get identity(): HostIdentity {
    return this.#identity!;
  }

  /** The loaded plugin, as of launch or the last recreate/configure. */
  get info(): PluginInfo {
    return this.#info!;
  }

  /** Resolves when the process has ended. */
  get exited(): Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }> {
    return this.#exited;
  }

  /** The end of what the host and the plugin wrote to stderr. */
  get diagnostics(): string {
    return this.#stderr;
  }

  on<E extends keyof HostEvents>(
    event: E,
    listener: (params: HostEvents[E]) => void,
  ): this {
    this.#events.on(event, listener);
    return this;
  }

  off<E extends keyof HostEvents>(
    event: E,
    listener: (params: HostEvents[E]) => void,
  ): this {
    this.#events.off(event, listener);
    return this;
  }

  once<E extends keyof HostEvents>(
    event: E,
    listener: (params: HostEvents[E]) => void,
  ): this {
    this.#events.once(event, listener);
    return this;
  }

  /** @internal */
  async ready(timeout: number, signal?: AbortSignal): Promise<void> {
    const identity = await this.#withTimeout(
      new Promise<HostIdentity>((resolve, reject) => {
        this.#hello = resolve;
        void this.#exited.then(() => reject(this.#failure));
      }),
      timeout,
      signal,
      'start',
    );
    if (identity.protocol !== PROTOCOL_VERSION)
      throw new Vst3HostError(
        'incompatible-host',
        `${this.#options.executable} speaks protocol ${identity.protocol}; this client speaks ${PROTOCOL_VERSION}. Use the executable of the same @soundor/vst3-host version.`,
        { ...identity },
      );
    this.#identity = identity;
  }

  /** @internal */
  async load(
    options: LaunchOptions,
    timeout: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const { result } = await this.#request(
      'load',
      {
        path: options.plugin,
        className: options.className,
        classId: options.classId,
        sampleRate: options.sampleRate,
        blockSize: options.blockSize,
        processMode: options.processMode,
        inputs: options.inputs,
        outputs: options.outputs,
        openEditor: options.editor === true,
        scale: options.scale,
      },
      undefined,
      { timeout, signal },
    );
    this.#info = result as PluginInfo;
  }

  async getInfo(options?: RequestOptions): Promise<PluginInfo> {
    this.#info = (await this.#request('info', {}, undefined, options))
      .result as PluginInfo;
    return this.#info;
  }

  async getParameters(options?: RequestOptions): Promise<ParameterInfo[]> {
    return (await this.#request('getParameters', {}, undefined, options))
      .result as ParameterInfo[];
  }

  async getParameter(
    id: number,
    options?: RequestOptions,
  ): Promise<ParameterInfo> {
    return (await this.#request('getParameter', { id }, undefined, options))
      .result as ParameterInfo;
  }

  /** Sets the controller's value now and hands the change to the processor
      at the first frame of the next process call. */
  async setParameter(
    id: number,
    value: ParameterValue | number,
    options?: RequestOptions,
  ): Promise<ParameterInfo> {
    const values = typeof value === 'number' ? { normalized: value } : value;
    return (
      await this.#request('setParameter', { id, ...values }, undefined, options)
    ).result as ParameterInfo;
  }

  async getLatency(options?: RequestOptions): Promise<LatencyInfo> {
    return (await this.#request('getLatency', {}, undefined, options))
      .result as LatencyInfo;
  }

  /** Processes `frames` frames, in blocks of at most the block size. */
  async process(request: ProcessRequest = {}): Promise<ProcessResult> {
    const info = this.#info!;
    const inputs = request.inputs ?? [];
    if (inputs.length > info.buses.audioInputs.length)
      throw new Vst3HostError(
        'invalid-request',
        `${inputs.length} input buses were given; "${info.name}" has ${info.buses.audioInputs.length}`,
      );
    let frames = request.frames;
    for (const [index, bus] of inputs.entries()) {
      if (bus == null) continue;
      for (const [channel, samples] of bus.entries()) {
        if (!(samples instanceof Float32Array))
          throw new Vst3HostError(
            'invalid-request',
            `inputs[${index}][${channel}] must be a Float32Array`,
          );
        frames ??= samples.length;
        if (samples.length !== frames)
          throw new Vst3HostError(
            'invalid-request',
            `inputs[${index}][${channel}] has ${samples.length} frames; the call processes ${frames}`,
          );
      }
    }
    if (frames === undefined)
      throw new Vst3HostError(
        'invalid-request',
        'process() needs `frames` when no input audio is given',
      );
    if (!Number.isInteger(frames) || frames < 0)
      throw new Vst3HostError(
        'invalid-request',
        `frames must be a non-negative integer, not ${frames}`,
      );
    const channels = inputs.map((bus) => bus?.length ?? 0);
    const bytes = channels.reduce((sum, count) => sum + count, 0) * frames * 4;
    const outputBytes =
      info.buses.audioOutputs
        .filter((bus) => bus.active)
        .reduce((sum, bus) => sum + bus.channels, 0) *
      frames *
      4;
    if (
      bytes > this.#options.maxPayloadBytes ||
      outputBytes > this.#options.maxPayloadBytes
    )
      throw new Vst3HostError(
        'message-too-large',
        `${frames} frames exceed the ${this.#options.maxPayloadBytes}-byte message limit; process them in several calls (the transport and plugin state carry over) or raise maxPayloadBytes`,
      );
    const payload = new Uint8Array(bytes);
    let offset = 0;
    for (const bus of inputs)
      for (const samples of bus ?? []) {
        payload.set(
          new Uint8Array(
            samples.buffer,
            samples.byteOffset,
            samples.byteLength,
          ),
          offset,
        );
        offset += samples.byteLength;
      }

    const { result, payload: output } = await this.#request(
      'process',
      {
        frames,
        inputs: channels,
        events: request.events,
        parameterChanges: request.parameterChanges,
        transport: request.transport,
      },
      payload,
      request,
    );
    const response = result as Omit<ProcessResult, 'outputs'> & {
      outputs: number[];
    };
    // The output's own buffer: aligned, and the caller's to keep.
    const audio = new Float32Array(output.byteLength / 4);
    new Uint8Array(audio.buffer).set(output);
    let position = 0;
    const outputs = response.outputs.map((count) =>
      Array.from({ length: count }, () => {
        const channel = audio.subarray(position, position + frames);
        position += frames;
        return channel;
      }),
    );
    return { ...response, outputs };
  }

  /** The processor's and the controller's state. Pending parameter changes
      reach the processor first (in a process call of zero frames). */
  async getState(options?: RequestOptions): Promise<PluginState> {
    const { result, payload } = await this.#request(
      'getState',
      {},
      undefined,
      options,
    );
    const { componentBytes } = result as { componentBytes: number };
    const bytes = new Uint8Array(payload);
    return {
      component: bytes.slice(0, componentBytes),
      controller: bytes.slice(componentBytes),
    };
  }

  async setState(state: PluginState, options?: RequestOptions): Promise<void> {
    const payload = new Uint8Array(
      state.component.byteLength + state.controller.byteLength,
    );
    payload.set(state.component, 0);
    payload.set(state.controller, state.component.byteLength);
    await this.#request(
      'setState',
      {
        componentBytes: state.component.byteLength,
        controllerBytes: state.controller.byteLength,
      },
      payload,
      options,
    );
  }

  /** Deactivates and reactivates the plugin: it clears delay lines, held
      notes and other processing state. The transport is kept. */
  async reset(options?: RequestOptions): Promise<void> {
    await this.#request('reset', {}, undefined, options);
  }

  /** A fresh instance of the same class and setup, in the same process.
      The transport starts over. */
  async recreate(options?: RequestOptions): Promise<PluginInfo> {
    this.#info = (await this.#request('recreate', {}, undefined, options))
      .result as PluginInfo;
    return this.#info;
  }

  /** A new sample rate, block size, mode or bus layout. What is not given
      stays as it is. */
  async configure(
    setup: ProcessingSetup,
    options?: RequestOptions,
  ): Promise<PluginInfo> {
    this.#info = (await this.#request('configure', setup, undefined, options))
      .result as PluginInfo;
    return this.#info;
  }

  async openEditor(
    options: RequestOptions & { scale?: number } = {},
  ): Promise<EditorInfo> {
    return (
      await this.#request(
        'openEditor',
        { scale: options.scale },
        undefined,
        options,
      )
    ).result as EditorInfo;
  }

  async closeEditor(options?: RequestOptions): Promise<EditorInfo> {
    return (await this.#request('closeEditor', {}, undefined, options))
      .result as EditorInfo;
  }

  async resizeEditor(
    width: number,
    height: number,
    options?: RequestOptions,
  ): Promise<EditorInfo> {
    return (
      await this.#request('resizeEditor', { width, height }, undefined, options)
    ).result as EditorInfo;
  }

  async getEditor(options?: RequestOptions): Promise<EditorInfo> {
    return (await this.#request('getEditor', {}, undefined, options))
      .result as EditorInfo;
  }

  /** Unloads the plugin and ends the process: politely, then by force.
      Safe to call more than once and after a failure. */
  close(timeout = 10_000): Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }> {
    this.#closing ??= (async () => {
      if (this.#exit) return this.#exit;
      this.#closeRequested = true;
      const kill = setTimeout(() => this.#child.kill('SIGKILL'), timeout);
      try {
        if (!this.#failure && this.#identity)
          await this.#request('shutdown', {}, undefined, { timeout }).catch(
            () => this.#child.kill('SIGKILL'),
          );
        else this.#child.kill('SIGKILL');
        this.#child.stdin!.end();
        return await this.#exited;
      } finally {
        clearTimeout(kill);
      }
    })();
    return this.#closing;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  // ── Requests ─────────────────────────────────────────────────────────

  #request(
    method: string,
    params: unknown,
    payload: Uint8Array | undefined,
    options: RequestOptions | undefined,
  ): Promise<{ result: unknown; payload: Buffer }> {
    if (this.#failure && method !== 'shutdown')
      return Promise.reject(this.#failure);
    if (this.#closing && method !== 'shutdown')
      return Promise.reject(
        new Vst3HostError('closed', 'the VST3 host is closing'),
      );
    if (options?.signal?.aborted)
      return Promise.reject(this.#aborted(method, options.signal));
    return new Promise((resolve, reject) => {
      const pending: Pending = {
        id: this.#nextId++,
        method,
        params,
        payload,
        timeout: options?.timeout ?? this.#options.requestTimeout,
        signal: options?.signal,
        resolve,
        reject,
        settled: false,
      };
      if (pending.signal) {
        pending.onAbort = () => {
          // Queued: never sent. Sent: the host finishes it, the answer is
          // dropped, and later requests still wait for it (its timeout
          // still applies).
          const index = this.#queue.indexOf(pending);
          if (index >= 0) this.#queue.splice(index, 1);
          this.#settle(pending, pending !== this.#current);
          reject(this.#aborted(method, pending.signal!));
        };
        pending.signal.addEventListener('abort', pending.onAbort, {
          once: true,
        });
      }
      this.#queue.push(pending);
      this.#pump();
    });
  }

  #aborted(method: string, signal: AbortSignal): Vst3HostError {
    return new Vst3HostError('aborted', `${method} was aborted`, undefined, {
      cause: signal.reason,
    });
  }

  #settle(pending: Pending, clearTimer = true): void {
    pending.settled = true;
    if (clearTimer) clearTimeout(pending.timer);
    if (pending.onAbort)
      pending.signal?.removeEventListener('abort', pending.onAbort);
  }

  #pump(): void {
    if (this.#current || this.#failure) return;
    const next = this.#queue.shift();
    if (!next) return;
    this.#current = next;
    next.timer = setTimeout(() => {
      // The host's state is unknown after a request it never finished.
      const error = new Vst3HostError(
        'timeout',
        `${next.method} did not finish within ${next.timeout} ms; the VST3 host was stopped${this.#stderrTail()}`,
        { method: next.method, timeout: next.timeout },
      );
      if (!next.settled) {
        this.#settle(next);
        next.reject(error);
      }
      this.#fail(error);
      this.#child.kill('SIGKILL');
    }, next.timeout);
    const frame = encodeFrame(
      { id: next.id, method: next.method, params: next.params },
      next.payload,
    );
    for (const part of frame) this.#child.stdin!.write(part);
  }

  #receive(frame: Frame): void {
    const header = frame.header as {
      id?: number;
      event?: string;
      params?: unknown;
      result?: unknown;
      error?: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
      };
    };
    if (typeof header.event === 'string') {
      if (header.event === 'hello')
        this.#hello?.(header.params as HostIdentity);
      else if (header.event === 'protocolError')
        this.#fail(
          new Vst3HostError(
            'protocol-error',
            `the host rejected the request stream: ${(header.params as { message: string }).message}`,
          ),
        );
      else this.#events.emit(header.event, header.params);
      return;
    }
    const pending = this.#current;
    if (!pending || header.id !== pending.id) {
      this.#fail(
        new Vst3HostError(
          'protocol-error',
          `the host answered request ${header.id}, not ${pending?.id}`,
        ),
      );
      this.#child.kill('SIGKILL');
      return;
    }
    this.#current = undefined;
    clearTimeout(pending.timer);
    if (!pending.settled) {
      this.#settle(pending);
      if (header.error)
        pending.reject(
          new Vst3HostError(
            header.error.code as Vst3HostError['code'],
            header.error.message,
            header.error.details,
          ),
        );
      else pending.resolve({ result: header.result, payload: frame.payload });
    }
    this.#pump();
  }

  #fail(error: Vst3HostError): void {
    this.#failure ??= error;
    const failed = [...(this.#current ? [this.#current] : []), ...this.#queue];
    this.#current = undefined;
    this.#queue = [];
    for (const pending of failed)
      if (!pending.settled) {
        this.#settle(pending);
        pending.reject(this.#failure);
      }
  }

  #stderrTail(): string {
    const tail = this.#stderr.trim().split('\n').slice(-12).join('\n');
    return tail ? `\nhost stderr:\n${tail}` : '';
  }

  async #withTimeout<T>(
    promise: Promise<T>,
    timeout: number,
    signal: AbortSignal | undefined,
    what: string,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Vst3HostError(
                  'timeout',
                  `the VST3 host did not ${what} within ${timeout} ms${this.#stderrTail()}`,
                ),
              ),
            timeout,
          );
          if (signal) {
            onAbort = () => reject(this.#aborted(what, signal));
            if (signal.aborted) onAbort();
            else signal.addEventListener('abort', onAbort, { once: true });
          }
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
    }
  }
}
