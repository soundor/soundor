/**
 * The Web host's audio: one AudioContext and a fixed graph of plain Web
 * Audio nodes. There is no Soundor DSP here; the project's own code
 * (`runtimes/web/src/audio.ts`) sits between the input and output buses.
 *
 *   source → input bus → (project's setupAudio) → output bus → master → out
 *
 * Browsers let a page start audio only from a user gesture, so the context
 * is created by `start()`, which the host UI calls from its Play button.
 * While the context runs, the transport follows its clock, and the source
 * plays while the transport does.
 */

import type { WebHost } from './host';
import { Listeners } from './listeners';
import { report } from './report';

/** What a project's `setupAudio` receives. */
export interface WebAudioSetupContext {
  /** The host's AudioContext. */
  readonly context: AudioContext;
  /** Where the host's audio source arrives. */
  readonly input: AudioNode;
  /** Where the plugin's output goes (on to the master volume). */
  readonly output: AudioNode;
}

/** Disconnects what a setup connected. */
export type WebAudioCleanup = () => void;

/**
 * A project's audio: connects `input` to `output` through any Web Audio
 * nodes, and may return a function that undoes it.
 */
export type WebAudioSetup = (
  setup: WebAudioSetupContext,
) => void | WebAudioCleanup | Promise<void | WebAudioCleanup>;

/** What the host plays into the plugin. */
export type AudioSource = 'oscillator' | 'file' | 'none';

export type AudioState = 'off' | 'starting' | 'running' | 'failed';

export interface WebAudioHostOptions {
  /** Loads the project's setup (`runtimes/web/src/audio.ts`). */
  readonly loadSetup?: () => Promise<WebAudioSetup | undefined>;
  /** Makes the AudioContext (injectable for tests). */
  readonly createContext?: () => AudioContext;
}

export interface AudioStatus {
  readonly state: AudioState;
  readonly sampleRate: number | null;
  readonly source: AudioSource;
  readonly fileName: string | null;
  readonly volume: number;
  readonly muted: boolean;
  /** Why audio failed, or why the project's setup was skipped. */
  readonly error: string | null;
}

/** The Web Audio render quantum: what a block is in the browser. */
const BLOCK_SIZE = 128;
/** How fast volume changes settle, in seconds (no clicks). */
const RAMP = 0.01;

export class WebAudioHost {
  readonly #host: WebHost;
  readonly #options: WebAudioHostOptions;
  readonly #listeners = new Listeners<AudioStatus>();
  #status: AudioStatus = {
    state: 'off',
    sampleRate: null,
    source: 'oscillator',
    fileName: null,
    volume: 0.8,
    muted: false,
    error: null,
  };
  #context: AudioContext | null = null;
  #input: GainNode | null = null;
  #master: GainNode | null = null;
  #playing: AudioScheduledSourceNode | null = null;
  #file: AudioBuffer | null = null;
  #cleanup: WebAudioCleanup | null = null;
  #unsubscribe: (() => void) | null = null;
  #starting: Promise<void> | null = null;

  constructor(host: WebHost, options: WebAudioHostOptions = {}) {
    this.#host = host;
    this.#options = options;
  }

  get status(): AudioStatus {
    return this.#status;
  }

  subscribe(listener: (status: AudioStatus) => void): () => void {
    return this.#listeners.add(listener, 'subscribe()');
  }

  /**
   * Starts audio: creates (or resumes) the context and builds the graph
   * once. Call it from a user gesture; the browser refuses otherwise.
   */
  start(): Promise<void> {
    if (this.#context !== null) {
      // Resuming needs the gesture too; it may fail where creating did not.
      return this.#context.resume().catch((error: unknown) => {
        this.#fail(error);
      });
    }
    this.#starting ??= this.#build();
    return this.#starting;
  }

  /** Chooses what plays into the plugin. A file is decoded first. */
  async setSource(source: AudioSource, file?: Blob & { name?: string }) {
    if (source === 'file') {
      if (file === undefined && this.#file === null) {
        throw new TypeError('An audio file is needed for the file source');
      }
      if (file !== undefined) {
        const context = this.#context;
        if (context === null) {
          throw new Error('Start audio before choosing a file');
        }
        this.#file = await context.decodeAudioData(await file.arrayBuffer());
        this.#update({ fileName: file.name ?? 'audio file' });
      }
    }
    this.#update({ source });
    this.#restartSource();
  }

  /** The master volume, from 0 to 1. */
  setVolume(volume: number): void {
    this.#update({ volume: Math.min(1, Math.max(0, volume)) });
    this.#applyVolume();
  }

  setMuted(muted: boolean): void {
    this.#update({ muted });
    this.#applyVolume();
  }

  /** Stops everything and closes the context. */
  dispose(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#stopSource();
    this.#runCleanup();
    void this.#context?.close().catch(() => {});
    this.#context = null;
  }

  async #build(): Promise<void> {
    this.#update({ state: 'starting', error: null });
    let context: AudioContext;
    try {
      // Created synchronously, still inside the user's gesture.
      context = (this.#options.createContext ?? (() => new AudioContext()))();
      this.#context = context;
      const input = context.createGain();
      const output = context.createGain();
      const master = context.createGain();
      output.connect(master);
      master.connect(context.destination);
      this.#input = input;
      this.#master = master;
      this.#applyVolume();
      await context.resume();
      await this.#setup(context, input, output);
    } catch (error) {
      this.#fail(error);
      return;
    }

    this.#host.setAudioFormat({
      sampleRate: context.sampleRate,
      blockSize: BLOCK_SIZE,
    });
    this.#host.setClock(() => context.currentTime * 1000);
    let playing = this.#host.snapshot().transport?.playing ?? false;
    if (playing) this.#startSource();
    this.#unsubscribe = this.#host.subscribe((snapshot) => {
      const now = snapshot.transport?.playing ?? false;
      if (now === playing) return;
      playing = now;
      if (now) this.#startSource();
      else this.#stopSource();
    });
    this.#update({ state: 'running', sampleRate: context.sampleRate });
  }

  /** The project's nodes between the buses; a failing setup passes through. */
  async #setup(
    context: AudioContext,
    input: AudioNode,
    output: AudioNode,
  ): Promise<void> {
    let setup: WebAudioSetup | undefined;
    try {
      setup = await this.#options.loadSetup?.();
      if (setup !== undefined) {
        this.#cleanup = (await setup({ context, input, output })) ?? null;
        return;
      }
    } catch (error) {
      report(error);
      this.#update({
        error: `The audio setup (runtimes/web/src/audio.ts) failed, so the input passes through: ${describe(error)}`,
      });
      this.#runCleanup();
      input.disconnect();
    }
    input.connect(output);
    this.#cleanup = () => input.disconnect();
  }

  #startSource(): void {
    const context = this.#context;
    const input = this.#input;
    if (context === null || input === null || this.#playing !== null) return;
    switch (this.#status.source) {
      case 'none':
        return;
      case 'oscillator': {
        const oscillator = context.createOscillator();
        oscillator.type = 'triangle';
        oscillator.frequency.value = 220;
        const level = context.createGain();
        level.gain.value = 0.3;
        oscillator.connect(level);
        level.connect(input);
        oscillator.onended = () => level.disconnect();
        oscillator.start();
        this.#playing = oscillator;
        return;
      }
      case 'file': {
        if (this.#file === null) return;
        const player = context.createBufferSource();
        player.buffer = this.#file;
        player.loop = true;
        player.connect(input);
        player.start(0, this.#host.currentSeconds() % this.#file.duration);
        this.#playing = player;
        return;
      }
    }
  }

  #stopSource(): void {
    const source = this.#playing;
    if (source === null) return;
    this.#playing = null;
    try {
      source.stop();
    } catch {
      // Never started.
    }
    source.disconnect();
  }

  #restartSource(): void {
    if (this.#playing === null) return;
    this.#stopSource();
    this.#startSource();
  }

  #applyVolume(): void {
    const master = this.#master;
    const context = this.#context;
    if (master === null || context === null) return;
    const value = this.#status.muted ? 0 : this.#status.volume;
    master.gain.setTargetAtTime(value, context.currentTime, RAMP);
  }

  #runCleanup(): void {
    const cleanup = this.#cleanup;
    this.#cleanup = null;
    try {
      cleanup?.();
    } catch (error) {
      report(error);
    }
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

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
