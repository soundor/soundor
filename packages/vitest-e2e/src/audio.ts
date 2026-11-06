import type {
  AudioBus,
  NoteOffEvent,
  NoteOnEvent,
  ParameterChange,
  ProcessRequest,
  ProcessResult,
  Vst3Host,
} from '@soundor/vst3-host';

/** Audio to measure: one channel, or a bus of them. */
export type Audio = Float32Array | AudioBus;

/** How long a signal is, in `frames` or `seconds` (1 second by default). */
export interface SignalOptions {
  frames?: number;
  seconds?: number;
  /** Hz; 48 000 by default, as the host's. */
  sampleRate?: number;
  /** The largest value; 1 by default. */
  amplitude?: number;
}

const DEFAULT_SAMPLE_RATE = 48_000;

function channels(audio: Audio): AudioBus {
  return audio instanceof Float32Array ? [audio] : audio;
}

function length(options: SignalOptions): number {
  const { frames, seconds, sampleRate = DEFAULT_SAMPLE_RATE } = options;
  if (frames !== undefined && seconds !== undefined)
    throw new TypeError('Give a signal frames or seconds, not both');
  const count = frames ?? Math.round((seconds ?? 1) * sampleRate);
  if (!Number.isInteger(count) || count < 0)
    throw new RangeError(`A signal has a whole number of frames, not ${count}`);
  return count;
}

/** A sine wave, starting at zero. */
export function sine(
  frequency: number,
  options: SignalOptions = {},
): Float32Array {
  const { sampleRate = DEFAULT_SAMPLE_RATE, amplitude = 1 } = options;
  const step = (2 * Math.PI * frequency) / sampleRate;
  return Float32Array.from(
    { length: length(options) },
    (_, frame) => amplitude * Math.sin(step * frame),
  );
}

/** Zeros. */
export function silence(options: SignalOptions = {}): Float32Array {
  return new Float32Array(length(options));
}

/** One sample of `amplitude` at frame `at` (0 by default), and zeros. */
export function impulse(
  options: SignalOptions & { at?: number } = {},
): Float32Array {
  const { amplitude = 1, at = 0 } = options;
  const signal = new Float32Array(length(options));
  if (at < 0 || at >= signal.length)
    throw new RangeError(
      `An impulse at ${at} is outside ${signal.length} frames`,
    );
  signal[at] = amplitude;
  return signal;
}

/** White noise, the same for the same `seed`, so that a test repeats. */
export function noise(
  options: SignalOptions & { seed?: number } = {},
): Float32Array {
  const { amplitude = 1, seed = 1 } = options;
  // mulberry32: small and good enough for a test signal.
  let state = seed >>> 0;
  return Float32Array.from({ length: length(options) }, () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return amplitude * (((mixed ^ (mixed >>> 14)) >>> 0) / 2 ** 31 - 1);
  });
}

/** The largest absolute sample of all channels. */
export function peak(audio: Audio): number {
  let largest = 0;
  for (const channel of channels(audio))
    for (const sample of channel)
      if (Math.abs(sample) > largest) largest = Math.abs(sample);
  return largest;
}

/** The root mean square of all channels together. */
export function rms(audio: Audio): number {
  let sum = 0;
  let count = 0;
  for (const channel of channels(audio)) {
    for (const sample of channel) sum += sample * sample;
    count += channel.length;
  }
  return count === 0 ? 0 : Math.sqrt(sum / count);
}

/** In place: the transform of `real`, `imaginary`, a power of two long. */
function fft(real: Float64Array, imaginary: Float64Array): void {
  const size = real.length;
  for (let i = 1, j = 0; i < size; ++i) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j]!, real[i]!];
      [imaginary[i], imaginary[j]] = [imaginary[j]!, imaginary[i]!];
    }
  }
  for (let width = 2; width <= size; width *= 2) {
    const angle = (-2 * Math.PI) / width;
    for (let start = 0; start < size; start += width) {
      for (let k = 0; k < width / 2; ++k) {
        const cos = Math.cos(angle * k);
        const sin = Math.sin(angle * k);
        const a = start + k;
        const b = a + width / 2;
        const re = real[b]! * cos - imaginary[b]! * sin;
        const im = real[b]! * sin + imaginary[b]! * cos;
        real[b] = real[a]! - re;
        imaginary[b] = imaginary[a]! - im;
        real[a] = real[a]! + re;
        imaginary[a] = imaginary[a]! + im;
      }
    }
  }
}

// About 5 seconds at 48 kHz, and a resolution far finer than a test needs.
const MAX_FFT_SIZE = 2 ** 18;

/**
 * The strongest frequency of a channel, in Hz; 0 for silence or under 4 frames.
 * Read between the bins of a Hann-windowed spectrum, it is good to well under
 * a bin (`sampleRate` / the frames used) for a steady tone.
 */
export function dominantFrequency(
  channel: Float32Array,
  sampleRate = DEFAULT_SAMPLE_RATE,
): number {
  if (channel.length < 4) return 0;
  let size = 4;
  while (size * 2 <= Math.min(channel.length, MAX_FFT_SIZE)) size *= 2;
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  for (let i = 0; i < size; ++i)
    real[i] =
      channel[i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
  fft(real, imaginary);
  const power = (bin: number) => real[bin]! ** 2 + imaginary[bin]! ** 2;
  let best = 0;
  let strongest = 0;
  // Bin 0 is the signal's offset, not a frequency.
  for (let bin = 1; bin <= size / 2; ++bin)
    if (power(bin) > strongest) {
      strongest = power(bin);
      best = bin;
    }
  if (strongest === 0) return 0;
  let offset = 0;
  if (best > 0 && best < size / 2) {
    const [a, b, c] = [power(best - 1), strongest, power(best + 1)].map(
      (value) => Math.log(Math.max(value, Number.MIN_VALUE)),
    ) as [number, number, number];
    const curve = a - 2 * b + c;
    if (curve !== 0) offset = (0.5 * (a - c)) / curve;
  }
  return ((best + offset) * sampleRate) / size;
}

/** A note on, for `events`: velocity 0 to 1, 0.8 by default. */
export function noteOn(
  pitch: number,
  options: Omit<NoteOnEvent, 'type' | 'pitch'> = {},
): NoteOnEvent {
  return { type: 'noteOn', pitch, velocity: 0.8, ...options };
}

/** A note off, for `events`. */
export function noteOff(
  pitch: number,
  options: Omit<NoteOffEvent, 'type' | 'pitch'> = {},
): NoteOffEvent {
  return { type: 'noteOff', pitch, ...options };
}

/** What {@link render} takes: a process request, and how to cut it up. */
export interface RenderRequest extends ProcessRequest {
  /**
   * The frames of each call, or several in turn, such as `[64, 37, 512]`. Each
   * call is a block of that size, up to the host's `blockSize`, for bugs that
   * show only at certain block boundaries.
   */
  blockSize: number | readonly number[];
}

/**
 * Processes a request as several calls, and puts the results together. Events
 * and parameter changes reach the call they fall in; what they report comes
 * back with times from the start of the whole request.
 */
export async function render(
  host: Vst3Host,
  request: RenderRequest,
): Promise<ProcessResult> {
  const { blockSize, frames: given, inputs = [], ...rest } = request;
  const sizes = typeof blockSize === 'number' ? [blockSize] : blockSize;
  if (sizes.length === 0 || sizes.some((size) => !(size > 0)))
    throw new RangeError('blockSize takes frames above zero');
  const frames =
    given ?? inputs.find((bus) => bus != null && bus.length > 0)?.[0]?.length;
  if (frames === undefined)
    throw new TypeError('render() needs `frames` when no input audio is given');

  if (frames === 0) return host.process({ ...rest, frames: 0, inputs });
  const results: ProcessResult[] = [];
  for (let start = 0, turn = 0; start < frames; ++turn) {
    const size = Math.min(sizes[turn % sizes.length]!, frames - start);
    const end = start + size;
    const within = <T extends { time?: number }>(items: readonly T[] = []) =>
      items
        .filter(({ time = 0 }) => time >= start && time < end)
        .map((item) => ({ ...item, time: (item.time ?? 0) - start }));
    results.push(
      await host.process({
        ...rest,
        frames: size,
        inputs: inputs.map(
          (bus) => bus?.map((channel) => channel.subarray(start, end)) ?? bus,
        ),
        events: within(request.events),
        parameterChanges: within(request.parameterChanges),
        // A change to the transport is one change, at the start.
        ...(start === 0 ? {} : { transport: undefined }),
      }),
    );
    start = end;
  }
  return joined(results, frames);
}

function joined(
  results: readonly ProcessResult[],
  frames: number,
): ProcessResult {
  const later = <T extends { time: number }>(
    pick: (result: ProcessResult) => readonly T[],
  ) => {
    let offset = 0;
    return results.flatMap((result) => {
      const moved = pick(result).map((item) => ({
        ...item,
        time: item.time + offset,
      }));
      offset += result.frames;
      return moved;
    });
  };
  const outputs = results[0]!.outputs.map((bus, index) =>
    bus.map((_, channel) => {
      const whole = new Float32Array(frames);
      let at = 0;
      for (const { outputs: each } of results) {
        const part = each[index]![channel]!;
        whole.set(part, at);
        at += part.length;
      }
      return whole;
    }),
  );
  return {
    frames,
    outputs,
    events: later((result) => result.events),
    parameterChanges: later((result) => result.parameterChanges),
    transport: results.at(-1)!.transport,
    warnings: results.flatMap((result) => result.warnings),
  };
}
