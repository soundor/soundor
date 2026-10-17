/**
 * One AudioContext: selected input → project DSP → master volume → speakers.
 * Input instances belong to the transport, and release their resources on
 * pause, replacement or disposal, including work that finishes after a switch.
 */
import type { WebHost } from './host';
import { Listeners } from './listeners';
import { report } from './report';

/** What a project's audio processor receives. */
export interface WebAudioSetupContext {
  /** The host's AudioContext. */
  readonly context: AudioContext;
  /** Where the selected host input arrives. */
  readonly input: AudioNode;
  /** Where the plugin's output goes, before master volume. */
  readonly output: AudioNode;
}

/** Releases the nodes, subscriptions or other resources a setup owns. */
export type WebAudioCleanup = () => void;

/** Connects the plugin's DSP between the host's input and output buses. */
export type WebAudioSetup = (
  setup: WebAudioSetupContext,
) => void | WebAudioCleanup | Promise<void | WebAudioCleanup>;

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
  /** Unique, nonempty id; built-in ids are reserved. */
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
  readonly loadSetup?: () => Promise<WebAudioSetup | undefined>;
  readonly inputs?: readonly WebAudioInput[];
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
  /** Why audio failed, or why the project's DSP was skipped. */
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
    const ids = new Set(BUILTIN_AUDIO_INPUTS.map((input) => input.id));
    for (const input of options.inputs ?? []) {
      if (!input.id.trim() || ids.has(input.id))
        throw new TypeError(
          `Duplicate, reserved or empty audio input id: ${input.id}`,
        );
      if (!input.label.trim() || typeof input.start !== 'function')
        throw new TypeError(
          `Audio input ${input.id} needs a label and start function`,
        );
      ids.add(input.id);
      this.#custom.set(input.id, Object.freeze({ ...input }));
    }
    this.inputs = Object.freeze([
      ...BUILTIN_AUDIO_INPUTS,
      ...[...this.#custom.values()].map(({ id, label }) =>
        Object.freeze({ id, label }),
      ),
    ]);
    const source = options.defaultInput ?? 'oscillator';
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
      const setup = await this.#options.loadSetup?.();
      if (this.#disposed) return;
      if (setup) {
        const cleanup = (await setup({ context, input, output })) ?? null;
        if (this.#disposed) {
          if (cleanup) safely(cleanup);
        } else this.#cleanup = cleanup;
        return;
      }
    } catch (error) {
      if (this.#disposed) return;
      report(error);
      this.#update({
        error: `The audio setup (runtimes/web/src/audio.ts) failed, so the input passes through: ${describe(error)}`,
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
      oscillator.type = 'triangle';
      oscillator.frequency.value = 220;
      level.gain.value = 0.3;
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
