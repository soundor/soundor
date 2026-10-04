/**
 * The Web host's state, which `soundor:host` reports to the plugin: the
 * audio setup and a transport with one tempo for the whole timeline (there
 * is no tempo map, so `timeInSeconds` follows from the position and tempo). The host controls it, through the methods here; the
 * plugin only observes it.
 *
 * While the transport plays, the position advances with the clock and
 * subscribers get a new snapshot on every animation frame. Stopped, nothing
 * runs.
 */

import { Listeners } from './listeners';

export interface TimeSignature {
  readonly numerator: number;
  readonly denominator: number;
}

/** The transport, as `soundor:host` declares it. */
export interface Transport {
  readonly playing: boolean;
  readonly recording: boolean;
  readonly looping: boolean;
  readonly bpm: number;
  readonly timeSignature: TimeSignature;
  /** Musical position in quarter notes, and where its bar starts. */
  readonly ppqPosition: number;
  readonly barStartPpq: number;
  readonly timeInSeconds: number;
  readonly timeInSamples: number;
}

/** The host state, as `soundor:host` declares it. */
export interface HostSnapshot {
  readonly sampleRate: number;
  readonly blockSize: number;
  readonly hostName: string;
  readonly transport: Transport | null;
}

/** requestAnimationFrame and cancelAnimationFrame, injectable for tests. */
export interface FrameScheduler {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

export interface WebHostOptions {
  /** The clock the transport runs on, in milliseconds. */
  readonly now?: () => number;
  readonly frames?: FrameScheduler;
}

/** What the host calls itself. */
export const HOST_NAME = 'Soundor Web';
/**
 * How many bars the transport loops while looping: from the start, or from
 * the bar where the time signature last changed.
 */
export const LOOP_BARS = 4;
/** The tempo range the host accepts. */
export const BPM_RANGE = { min: 20, max: 999 } as const;

const DENOMINATORS = [1, 2, 4, 8, 16, 32];

const browserFrames: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export class WebHost {
  readonly #frames: FrameScheduler;
  #now: () => number;
  readonly #listeners = new Listeners<HostSnapshot>();

  #sampleRate = 48000;
  #blockSize = 128;
  #playing = false;
  #looping = false;
  #bpm = 120;
  #timeSignature: TimeSignature = Object.freeze({
    numerator: 4,
    denominator: 4,
  });
  /** The position (quarter notes) when the clock read `#anchorTime`. */
  #anchorPpq = 0;
  #anchorTime = 0;
  /** A bar line: bars are counted from here in the current time signature. */
  #barOriginPpq = 0;

  #snapshot: HostSnapshot | null = null;
  #frame: number | null = null;

  constructor(options: WebHostOptions = {}) {
    this.#now = options.now ?? (() => performance.now());
    this.#frames = options.frames ?? browserFrames;
  }

  /**
   * The current state. The same object until the state changes (every frame
   * while playing), so it works as a store snapshot, e.g. for React's
   * useSyncExternalStore.
   */
  snapshot(): HostSnapshot {
    this.#snapshot ??= this.#take();
    return this.#snapshot;
  }

  /** Calls `listener` with each new snapshot. Returns an unsubscribe function. */
  subscribe(listener: (snapshot: HostSnapshot) => void): () => void {
    return this.#listeners.add(listener, 'subscribe()');
  }

  /** Starts the transport from where it is. */
  play(): void {
    if (this.#playing) return;
    this.#anchorTime = this.#now();
    this.#playing = true;
    this.#changed();
    this.#frame ??= this.#frames.request(this.#tick);
  }

  /** Stops the transport where it is. */
  pause(): void {
    if (!this.#playing) return;
    this.#settle();
    this.#playing = false;
    this.#stopFrames();
    this.#changed();
  }

  /** Stops the transport and returns it to the start. */
  stop(): void {
    this.#playing = false;
    this.#anchorPpq = 0;
    this.#barOriginPpq = 0;
    this.#stopFrames();
    this.#changed();
  }

  /** Sets the tempo, clamped to {@link BPM_RANGE}. */
  setBpm(bpm: number): void {
    if (!Number.isFinite(bpm)) {
      throw new RangeError(`BPM must be a finite number, got ${bpm}`);
    }
    const next = Math.min(BPM_RANGE.max, Math.max(BPM_RANGE.min, bpm));
    if (next === this.#bpm) return;
    this.#settle();
    this.#bpm = next;
    this.#changed();
  }

  /**
   * Sets the time signature. The current bar keeps its start; the next bar
   * line follows the new signature.
   */
  setTimeSignature(numerator: number, denominator: number): void {
    if (!Number.isInteger(numerator) || numerator < 1 || numerator > 32) {
      throw new RangeError(
        `The numerator must be an integer from 1 to 32, got ${numerator}`,
      );
    }
    if (!DENOMINATORS.includes(denominator)) {
      throw new RangeError(
        `The denominator must be one of ${DENOMINATORS.join(', ')}, got ${denominator}`,
      );
    }
    const current = this.#timeSignature;
    if (current.numerator === numerator && current.denominator === denominator)
      return;
    this.#settle();
    this.#barOriginPpq = this.#barStart(this.#anchorPpq);
    this.#timeSignature = Object.freeze({ numerator, denominator });
    this.#changed();
  }

  /** Loops {@link LOOP_BARS} bars, or stops looping. */
  setLooping(looping: boolean): void {
    if (looping === this.#looping) return;
    this.#settle();
    this.#looping = looping;
    this.#anchorPpq = this.#wrap(this.#anchorPpq);
    this.#changed();
  }

  /** What the audio output runs at. */
  setAudioFormat(format: { sampleRate: number; blockSize: number }): void {
    if (
      format.sampleRate === this.#sampleRate &&
      format.blockSize === this.#blockSize
    )
      return;
    this.#sampleRate = format.sampleRate;
    this.#blockSize = format.blockSize;
    this.#changed();
  }

  /** Moves the transport onto another clock (milliseconds), without a jump. */
  setClock(now: () => number): void {
    this.#settle();
    this.#now = now;
    this.#anchorTime = now();
  }

  /** Stops the frame loop; the host is not used afterwards. */
  dispose(): void {
    this.#playing = false;
    this.#stopFrames();
  }

  readonly #tick = (): void => {
    this.#frame = this.#frames.request(this.#tick);
    this.#changed();
  };

  #stopFrames(): void {
    if (this.#frame === null) return;
    this.#frames.cancel(this.#frame);
    this.#frame = null;
  }

  #changed(): void {
    this.#snapshot = this.#take();
    this.#listeners.notify(this.#snapshot);
  }

  /** Moves the anchor to now, so the next change starts from here. */
  #settle(): void {
    if (!this.#playing) return;
    const time = this.#now();
    this.#anchorPpq = this.#positionAt(time);
    this.#anchorTime = time;
  }

  #positionAt(time: number): number {
    if (!this.#playing) return this.#anchorPpq;
    const elapsed = Math.max(0, time - this.#anchorTime) / 1000;
    return this.#wrap(this.#anchorPpq + (elapsed * this.#bpm) / 60);
  }

  /** Quarter notes per bar: numerator × 4 / denominator. */
  #barLength(): number {
    const { numerator, denominator } = this.#timeSignature;
    return (numerator * 4) / denominator;
  }

  #barStart(ppq: number): number {
    const length = this.#barLength();
    const origin = this.#barOriginPpq;
    return origin + Math.floor((ppq - origin) / length) * length;
  }

  #wrap(ppq: number): number {
    if (!this.#looping) return ppq;
    const end = this.#barOriginPpq + LOOP_BARS * this.#barLength();
    if (ppq < end) return ppq;
    return (
      this.#barOriginPpq +
      ((ppq - this.#barOriginPpq) % (end - this.#barOriginPpq))
    );
  }

  #take(): HostSnapshot {
    const ppq = this.#positionAt(this.#now());
    const seconds = (ppq * 60) / this.#bpm;
    return Object.freeze({
      sampleRate: this.#sampleRate,
      blockSize: this.#blockSize,
      hostName: HOST_NAME,
      transport: Object.freeze({
        playing: this.#playing,
        recording: false,
        looping: this.#looping,
        bpm: this.#bpm,
        timeSignature: this.#timeSignature,
        ppqPosition: ppq,
        barStartPpq: this.#barStart(ppq),
        timeInSeconds: seconds,
        timeInSamples: Math.round(seconds * this.#sampleRate),
      }),
    });
  }
}
