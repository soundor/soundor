import type { createProcessorNode } from '@soundor/engine/web/processor';

/**
 * One AudioContext: selected input → the plugin's processor (its Rust crate,
 * lib/, as WebAssembly in an AudioWorklet) → master volume → speakers.
 * Input instances belong to the transport, and release their resources on
 * pause, replacement or disposal, including work that finishes after a switch.
 */
import { defaultInputs } from '../input-options';
import type { WebProcessorState } from './audio-state';
import type { HostSnapshot, WebHost } from './host';
import { validateInputs, type WebInput } from './input';
import { Listeners } from './listeners';
import type { WebNativeStream } from './manifest';
import { publishParameter, type WebParameter } from './parameters';
import { report } from './report';

/** Releases the nodes, subscriptions or other resources an input owns. */
export type WebAudioCleanup = () => void;

/** The plugin's processor, as the host runs it. */
export interface WebProcessorSource {
  /** The WebAssembly module of lib/. */
  readonly wasm: Uint8Array;
  /** Every parameter, in the config's order: the processor's values. */
  readonly parameters: readonly WebParameter[];
  /** The native streams, in name order, as the processor numbers them. */
  readonly streams: readonly WebNativeStream[];
  /** Publishes stream `index`'s value, as the processing published it. */
  readonly publishStream: (index: number, value: unknown) => void;
  /** The state the processing reads (`audio: true`); none by default. */
  readonly resources?: {
    subscribeResources(
      listener: (index: number, bytes: Uint8Array) => void,
    ): () => void;
  };
  readonly state?: WebProcessorState;
}

/** A parameter's value as the processor has it: a boolean's 0 or 1, a choice's index. */
export function plainValue(parameter: WebParameter): number {
  const value = parameter.get();
  const info = parameter.info;
  if (info.type === 'boolean') return value === true ? 1 : 0;
  if (info.type === 'choice')
    return Math.max(
      0,
      info.options.findIndex((option) => option.value === value),
    );
  return value as number;
}

function fromPlain(parameter: WebParameter, plain: number): unknown {
  const info = parameter.info;
  if (info.type === 'boolean') return plain >= 0.5;
  if (info.type === 'choice')
    return info.options[Math.round(plain)]?.value ?? info.default;
  return plain;
}

/** The transport's slots, as the processor reads them. */
export function transportValues(snapshot: HostSnapshot): number[] {
  const transport = snapshot.transport;
  if (transport == null) return [NaN, NaN, NaN, 0, 0, 0];
  return [
    transport.bpm,
    transport.timeInSeconds,
    transport.ppqPosition,
    transport.playing ? 1 : 0,
    transport.timeSignature.numerator,
    transport.timeSignature.denominator,
  ];
}

/** What a custom input receives for one playback instance. */
export interface WebAudioInputContext {
  /** The host's AudioContext; do not create a separate one. */
  readonly context: AudioContext;
  /** Connect the source here to send it through the plugin's DSP. */
  readonly destination: AudioNode;
  /** Transport position at startup, in seconds (for seeking a loop). */
  readonly timeInSeconds: number;
  /** Aborted on pause, input replacement or disposal; pass it to async work. */
  readonly signal: AbortSignal;
}

/** A project-defined source in the host panel's Input selector. */
export interface WebAudioInput {
  /** Unique, nonempty id; oscillator, file, microphone and none are reserved. */
  readonly id: string;
  /** Human-readable name in the host's Input selector. */
  readonly label: string;
  /**
   * Called on Play, after DSP setup. Connect to destination and return a
   * cleanup that stops/disconnects everything created. Async startup is
   * allowed: late results are cleaned up even if signal was ignored.
   */
  readonly start: (
    input: WebAudioInputContext,
  ) => WebAudioCleanup | Promise<WebAudioCleanup>;
}

/** A selectable input, without its factory. */
export interface WebAudioInputInfo {
  readonly id: string;
  readonly label: string;
}

export type AudioSource =
  | 'oscillator'
  | 'file'
  | 'microphone'
  | 'none'
  | (string & {});
export type AudioState = 'off' | 'starting' | 'running' | 'failed';
export type AudioInputState = 'idle' | 'starting' | 'running' | 'failed';

export const BUILTIN_AUDIO_INPUTS: readonly WebAudioInputInfo[] = Object.freeze(
  [
    { id: 'oscillator', label: 'Oscillator' },
    { id: 'file', label: 'Audio file…' },
    { id: 'microphone', label: 'Microphone' },
    { id: 'none', label: 'No input' },
  ].map((input) => Object.freeze(input)),
);

export interface WebAudioHostOptions {
  /** Declared main bus counts; omitted for legacy browser mixing behavior. */
  readonly audio?: {
    readonly inputChannels: number;
    readonly outputChannels: number;
  };
  /** The plugin's processor; without one, the input passes through. */
  readonly loadProcessor?: () => Promise<WebProcessorSource | undefined>;
  /** Injectable for tests. */
  readonly createProcessorNode?: typeof createProcessorNode;
  readonly inputs?: readonly WebAudioInput[];
  /** Complete selection for the managed host; replaces the built-in defaults. */
  readonly configuredInputs?: readonly WebInput[];
  readonly defaultInput?: string;
  /** Injectable Web APIs for tests. */
  readonly createContext?: () => AudioContext;
  readonly getUserMedia?: (
    constraints: MediaStreamConstraints,
  ) => Promise<MediaStream>;
}

export interface AudioStatus {
  readonly state: AudioState;
  readonly sampleRate: number | null;
  readonly source: AudioSource;
  readonly inputState: AudioInputState;
  readonly inputError: string | null;
  readonly fileName: string | null;
  readonly volume: number;
  readonly muted: boolean;
  /** Why audio failed, or why the plugin's processor was skipped. */
  readonly error: string | null;
}

interface ActiveInput {
  readonly source: AudioSource;
  readonly controller: AbortController;
  readonly bus: GainNode;
  cleanup?: WebAudioCleanup;
}

const BLOCK_SIZE = 128;
const RAMP = 0.01;

export class WebAudioHost {
  readonly #host: WebHost;
  readonly #options: WebAudioHostOptions;
  readonly #listeners = new Listeners<AudioStatus>();
  readonly #custom = new Map<string, WebAudioInput>();
  readonly inputs: readonly WebAudioInputInfo[];
  #status: AudioStatus;
  #context: AudioContext | null = null;
  #input: GainNode | null = null;
  #master: GainNode | null = null;
  #active: ActiveInput | null = null;
  #file: AudioBuffer | null = null;
  #loadingFile = false;
  #selection = 0;
  #cleanup: WebAudioCleanup | null = null;
  #unsubscribe: (() => void) | null = null;
  #starting: Promise<void> | null = null;
  #disposed = false;

  constructor(host: WebHost, options: WebAudioHostOptions = {}) {
    this.#host = host;
    this.#options = options;
    const inputs = validateInputs(
      options.configuredInputs ?? [...defaultInputs, ...(options.inputs ?? [])],
    );
    const ids = new Set(['none']);
    const infos: WebAudioInputInfo[] = [];
    for (const input of inputs) {
      if ('type' in input) {
        ids.add(input.type);
        infos.push(BUILTIN_AUDIO_INPUTS.find(({ id }) => id === input.type)!);
      } else {
        ids.add(input.id);
        this.#custom.set(input.id, Object.freeze({ ...input }));
        infos.push({ id: input.id, label: input.label });
      }
    }
    this.inputs = Object.freeze([...infos, { id: 'none', label: 'No input' }]);
    const source =
      options.defaultInput ??
      (options.configuredInputs === undefined
        ? 'oscillator'
        : (infos.find(({ id }) => id !== 'file' && id !== 'microphone')?.id ??
          'none'));
    if (!ids.has(source))
      throw new TypeError(`Unknown default audio input: ${source}`);
    if (source === 'microphone' || source === 'file')
      throw new TypeError(
        'Microphone and file inputs must be selected explicitly',
      );
    this.#status = {
      state: 'off',
      sampleRate: null,
      source,
      inputState: 'idle',
      inputError: null,
      fileName: null,
      volume: 0.8,
      muted: false,
      error: null,
    };
  }

  get status(): AudioStatus {
    return this.#status;
  }

  subscribe(listener: (status: AudioStatus) => void): () => void {
    return this.#listeners.add(listener, 'subscribe()');
  }

  /** Creates/resumes audio from a gesture; inputs open only when selected and playing. */
  start(): Promise<void> {
    if (this.#disposed)
      return Promise.reject(new Error('The audio host is disposed'));
    if (this.#starting) return this.#starting;
    if (this.#context)
      return this.#context
        .resume()
        .catch((error: unknown) => this.#fail(error));
    this.#starting = this.#build().finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  /** Selects one input. Capture and custom sources start only while playing. */
  async setSource(
    source: AudioSource,
    file?: Blob & { name?: string },
  ): Promise<void> {
    if (this.#disposed) throw new Error('The audio host is disposed');
    if (!this.inputs.some((input) => input.id === source))
      throw new TypeError(`Unknown audio input: ${source}`);
    if (source === 'file') {
      if (!file && !this.#file)
        throw new TypeError('An audio file is needed for the file source');
      if (file && !this.#context)
        throw new Error('Start audio before choosing a file');
    }
    const selection = ++this.#selection;
    this.#stopSource();
    this.#loadingFile = source === 'file' && file !== undefined;
    this.#update({
      source,
      inputError: null,
      inputState: this.#loadingFile ? 'starting' : 'idle',
    });
    if (source === 'file' && file) {
      this.#file = null;
      this.#update({ fileName: null });
      try {
        const buffer = await this.#context!.decodeAudioData(
          await file.arrayBuffer(),
        );
        if (selection !== this.#selection || this.#disposed) return;
        this.#file = buffer;
        this.#update({ fileName: file.name ?? 'audio file' });
      } catch (error) {
        if (selection !== this.#selection || this.#disposed) return;
        this.#loadingFile = false;
        this.#update({
          inputState: 'failed',
          inputError: `Audio file could not load: ${describe(error)}`,
        });
        throw error;
      }
      this.#loadingFile = false;
    }
    if (this.#host.snapshot().transport?.playing) this.#startSource();
  }

  setVolume(volume: number): void {
    this.#update({ volume: Math.min(1, Math.max(0, volume)) });
    this.#applyVolume();
  }

  setMuted(muted: boolean): void {
    this.#update({ muted });
    this.#applyVolume();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#selection++;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#stopSource();
    this.#runCleanup();
    void this.#context?.close().catch(report);
    this.#context = null;
  }

  async #build(): Promise<void> {
    this.#update({ state: 'starting', error: null });
    let context: AudioContext;
    try {
      context = (this.#options.createContext ?? (() => new AudioContext()))();
      this.#context = context;
      const input = context.createGain(),
        output = context.createGain(),
        master = context.createGain();
      if (this.#options.audio) {
        input.channelCount = Math.max(1, this.#options.audio.inputChannels);
        input.channelCountMode = 'explicit';
        output.channelCount = this.#options.audio.outputChannels;
        output.channelCountMode = 'explicit';
      }
      output.connect(master);
      master.connect(context.destination);
      this.#input = input;
      this.#master = master;
      this.#applyVolume();
      await context.resume();
      if (this.#disposed) return;
      await this.#setup(context, input, output);
      if (this.#disposed) return;
    } catch (error) {
      if (!this.#disposed) {
        void this.#context?.close().catch(report);
        this.#context = null;
        this.#fail(error);
      }
      return;
    }
    this.#host.setAudioFormat({
      sampleRate: context.sampleRate,
      blockSize: BLOCK_SIZE,
    });
    this.#host.setClock(() => context.currentTime * 1000);
    this.#update({ state: 'running', sampleRate: context.sampleRate });
    let playing = this.#host.snapshot().transport?.playing ?? false;
    if (playing) this.#startSource();
    this.#unsubscribe = this.#host.subscribe((snapshot) => {
      const now = snapshot.transport?.playing ?? false;
      if (now === playing) return;
      playing = now;
      if (now) this.#startSource();
      else this.#stopSource();
    });
  }

  async #setup(
    context: AudioContext,
    input: AudioNode,
    output: AudioNode,
  ): Promise<void> {
    try {
      const source = await this.#options.loadProcessor?.();
      if (this.#disposed) return;
      if (source) {
        const layout = this.#options.audio ?? {
          inputChannels: 2,
          outputChannels: 2,
        };
        const parameters = source.parameters;
        const readOnly = parameters.filter(
          (parameter) => parameter.info.access === 'readOnly',
        );
        const plain = () => parameters.map(plainValue);
        // The engine's processor host, loaded once there is a processor to
        // run: a page without one never fetches it.
        const create =
          this.#options.createProcessorNode ??
          (await import('@soundor/engine/web/processor')).createProcessorNode;
        if (this.#disposed) return;
        const processor = await create(context, {
          wasm: source.wasm,
          contract: {
            parameters: parameters.length,
            published: readOnly.length,
            streams: source.streams.length,
            state: source.state?.size ?? 0,
          },
          inputs: layout.inputChannels > 0 ? [layout.inputChannels] : [],
          outputs: [layout.outputChannels],
          streams: source.streams.map(({ kind, element }) => ({
            kind,
            element,
          })),
          parameters: plain(),
          ...(source.state !== undefined && source.state.size > 0
            ? { state: source.state.snapshot() }
            : {}),
          onPublished: (values) =>
            readOnly.forEach((parameter, slot) => {
              const value = values[slot];
              if (value !== undefined && !Number.isNaN(value))
                publishParameter(
                  parameter,
                  fromPlain(parameter, value) as never,
                );
            }),
          onStreams: (changes) => {
            for (const [index, value] of changes)
              source.publishStream(index, value);
          },
          onError: (message) =>
            this.#update({
              error: `The audio processor (lib/) failed: ${message}`,
            }),
        });
        try {
          await processor.ready;
        } catch (error) {
          processor.dispose();
          throw error;
        }
        if (this.#disposed) {
          processor.dispose();
          return;
        }
        // The processing sets the read-only ones: they need not go back.
        const unsubscribe = parameters
          .filter((parameter) => parameter.info.access !== 'readOnly')
          .map((parameter) =>
            parameter.subscribe(() => processor.setParameters(plain())),
          );
        if (source.resources !== undefined)
          unsubscribe.push(
            source.resources.subscribeResources((index, bytes) =>
              processor.publishResource(index, bytes),
            ),
          );
        // Any that moved while it loaded.
        processor.setParameters(plain());
        const state = source.state;
        if (state !== undefined && state.size > 0) {
          unsubscribe.push(
            state.subscribe(() => processor.setState(state.snapshot())),
          );
          processor.setState(state.snapshot());
        }
        let transport = transportValues(this.#host.snapshot());
        processor.setTransport(transport);
        unsubscribe.push(
          this.#host.subscribe((snapshot) => {
            const next = transportValues(snapshot);
            if (
              next.some((value, index) => !Object.is(value, transport[index]))
            ) {
              transport = next;
              processor.setTransport(next);
            }
          }),
        );
        if (layout.inputChannels > 0) input.connect(processor.node);
        processor.node.connect(output);
        this.#cleanup = () => {
          for (const stop of unsubscribe) stop();
          input.disconnect();
          processor.dispose();
        };
        return;
      }
    } catch (error) {
      if (this.#disposed) return;
      report(error);
      this.#update({
        error: `The audio processor (lib/) could not start, so the input passes through: ${describe(error)}`,
      });
      input.disconnect();
    }
    input.connect(output);
    this.#cleanup = () => input.disconnect();
  }

  #startSource(): void {
    const context = this.#context,
      input = this.#input,
      source = this.#status.source;
    if (
      !context ||
      !input ||
      this.#disposed ||
      this.#status.state !== 'running' ||
      this.#active ||
      this.#loadingFile
    )
      return;
    if (this.#options.audio?.inputChannels === 0) return;
    if (source === 'none' || (source === 'file' && !this.#file)) return;
    const bus = context.createGain();
    bus.connect(input);
    const active: ActiveInput = {
      source,
      bus,
      controller: new AbortController(),
    };
    this.#active = active;
    this.#update({ inputState: 'starting', inputError: null });
    try {
      const result = this.#connectSource(active, context);
      if (typeof result === 'function') this.#completeSource(active, result);
      else
        void result.then(
          (cleanup) => this.#completeSource(active, cleanup),
          (error: unknown) => this.#sourceFailed(active, error),
        );
    } catch (error) {
      this.#sourceFailed(active, error);
    }
  }

  #connectSource(
    active: ActiveInput,
    context: AudioContext,
  ): WebAudioCleanup | Promise<WebAudioCleanup> {
    const { source, bus, controller } = active;
    if (source === 'microphone') return this.#microphone(active, context);
    if (source === 'oscillator') {
      const oscillator = context.createOscillator(),
        level = context.createGain();
      const definition = this.#options.configuredInputs?.find(
        (input) => 'type' in input && input.type === 'oscillator',
      );
      const options =
        definition && 'type' in definition && definition.type === 'oscillator'
          ? definition
          : undefined;
      oscillator.type = options?.waveform ?? 'triangle';
      oscillator.frequency.value = options?.frequency ?? 220;
      level.gain.value = options?.gain ?? 0.3;
      oscillator.connect(level);
      level.connect(bus);
      oscillator.start();
      return () => {
        oscillator.stop();
        oscillator.disconnect();
        level.disconnect();
      };
    }
    if (source === 'file') {
      const player = context.createBufferSource();
      player.buffer = this.#file;
      player.loop = true;
      player.connect(bus);
      player.start(0, this.#host.currentSeconds() % this.#file!.duration);
      return () => {
        player.stop();
        player.disconnect();
      };
    }
    return this.#custom.get(source)!.start({
      context,
      destination: bus,
      timeInSeconds: this.#host.currentSeconds(),
      signal: controller.signal,
    });
  }

  async #microphone(
    active: ActiveInput,
    context: AudioContext,
  ): Promise<WebAudioCleanup> {
    const getUserMedia = this.#options.getUserMedia ?? requestMicrophone;
    const stream = await getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    const tracks = stream.getTracks();
    if (active.controller.signal.aborted) {
      tracks.forEach((track) => track.stop());
      return () => {};
    }
    let node: MediaStreamAudioSourceNode;
    const ended = () =>
      this.#sourceFailed(
        active,
        new Error('Microphone disconnected or access was revoked'),
      );
    try {
      if (
        !stream.getAudioTracks().length ||
        tracks.some((track) => track.readyState === 'ended')
      )
        throw new Error('No active microphone track');
      node = context.createMediaStreamSource(stream);
      node.connect(active.bus);
      tracks.forEach((track) => track.addEventListener('ended', ended));
    } catch (error) {
      tracks.forEach((track) => track.stop());
      throw error;
    }
    return () => {
      node.disconnect();
      tracks.forEach((track) => {
        track.removeEventListener('ended', ended);
        track.stop();
      });
    };
  }

  #completeSource(active: ActiveInput, cleanup: WebAudioCleanup): void {
    if (typeof cleanup !== 'function') {
      this.#sourceFailed(
        active,
        new TypeError('Audio input start() must return a cleanup function'),
      );
      return;
    }
    if (this.#active !== active || active.controller.signal.aborted) {
      safely(cleanup);
      return;
    }
    active.cleanup = cleanup;
    this.#update({ inputState: 'running' });
  }

  #sourceFailed(active: ActiveInput, error: unknown): void {
    if (this.#active !== active || active.controller.signal.aborted) return;
    this.#stopSource();
    const detail =
      active.source === 'microphone' &&
      error instanceof Error &&
      error.name === 'NotAllowedError'
        ? 'Microphone permission was denied. Allow access in your browser and retry.'
        : describe(error);
    this.#update({
      inputState: 'failed',
      inputError: `${active.source === 'microphone' ? 'Microphone' : 'Audio input'} could not start: ${detail}`,
    });
  }

  #stopSource(): void {
    const active = this.#active;
    this.#active = null;
    if (active) {
      active.controller.abort();
      active.bus.disconnect();
      if (active.cleanup) safely(active.cleanup);
    }
    this.#update({ inputState: 'idle' });
  }

  #applyVolume(): void {
    if (!this.#master || !this.#context) return;
    this.#master.gain.setTargetAtTime(
      this.#status.muted ? 0 : this.#status.volume,
      this.#context.currentTime,
      RAMP,
    );
  }

  #runCleanup(): void {
    const cleanup = this.#cleanup;
    this.#cleanup = null;
    if (cleanup) safely(cleanup);
  }

  #fail(error: unknown): void {
    report(error);
    this.#update({
      state: 'failed',
      error: `Audio could not start: ${describe(error)}`,
    });
  }

  #update(change: Partial<AudioStatus>): void {
    this.#status = { ...this.#status, ...change };
    this.#listeners.notify(this.#status);
  }
}

function requestMicrophone(
  constraints: MediaStreamConstraints,
): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia)
    throw new Error(
      'Microphone input needs HTTPS or localhost and a browser with microphone support',
    );
  return navigator.mediaDevices.getUserMedia(constraints);
}

function safely(cleanup: WebAudioCleanup): void {
  try {
    cleanup();
  } catch (error) {
    report(error);
  }
}
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
