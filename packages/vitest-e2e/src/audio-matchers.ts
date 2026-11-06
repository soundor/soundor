import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import type { AudioBus } from '@soundor/vst3-host';
import { inject } from 'vitest';

import { peak } from './audio';
import { resultsDir } from './results';
import type { UpdateMode } from './screenshot';
import { readWav, writeWav } from './wav';

/** Options of `toBeSilent`. */
export interface SilenceOptions {
  /** The largest absolute sample that still counts as silence (about -120 dB,
      0.000001, by default). */
  threshold?: number;
}

/** Options of the matchers that compare audio. */
export interface AudioMatcherOptions {
  /** How far a sample may be from the expected one (0.0001, about -80 dB, by
      default). */
  tolerance?: number;
  /** Hz, for the files it writes; 48 000 by default. */
  sampleRate?: number;
}

declare module 'vitest' {
  interface Matchers<
    // oxlint-disable-next-line no-unused-vars -- Matchers must keep Vitest's type parameters.
    R extends void | Promise<void> = void | Promise<void>,
    // oxlint-disable-next-line no-unused-vars
    T = unknown,
  > {
    /** A channel or bus has nothing above `threshold`. */
    toBeSilent(options?: SilenceOptions): void;
    /** A channel or bus is the same as this one, within `tolerance`. */
    toBeCloseToAudio(
      expected: Float32Array | AudioBus,
      options?: AudioMatcherOptions,
    ): void;
    /** A channel or bus is the same as a WAV file saved beside the test, within
        `tolerance`. Saved the first time, and again with Vitest's `-u`. */
    toMatchAudioSnapshot(name?: string, options?: AudioMatcherOptions): void;
  }
}

interface MatcherContext {
  isNot?: boolean;
  testPath?: string | undefined;
  currentTestName?: string | undefined;
  snapshotState?: object;
}

const TOLERANCE = 0.0001;
const SAMPLE_RATE = 48_000;
const ok = { pass: true, message: () => '' };

function bus(received: unknown, matcher: string): AudioBus {
  if (received instanceof Float32Array) return [received];
  if (
    Array.isArray(received) &&
    received.every((channel) => channel instanceof Float32Array)
  )
    return received as Float32Array[];
  throw new TypeError(
    `${matcher} expects a channel or a bus: a Float32Array or an array of them, such as outputs[0]`,
  );
}

/** How two buses differ first, or nothing if they do not. */
function difference(
  actual: AudioBus,
  expected: AudioBus,
  tolerance: number,
): string | undefined {
  if (actual.length !== expected.length)
    return `it has ${actual.length} channels, not ${expected.length}`;
  for (const [index, channel] of actual.entries())
    if (channel.length !== expected[index]!.length)
      return `channel ${index} has ${channel.length} frames, not ${expected[index]!.length}`;
  let count = 0;
  let first: string | undefined;
  for (const [index, channel] of actual.entries())
    for (const [frame, sample] of channel.entries()) {
      const wanted = expected[index]![frame]!;
      if (Math.abs(sample - wanted) <= tolerance) continue;
      ++count;
      first ??= `channel ${index}, frame ${frame}, is ${sample}, not ${wanted}`;
    }
  return (
    first && `${count} samples differ by over ${tolerance}: first, ${first}`
  );
}

/** Keeps both to listen to; never changes why the test failed. */
function keep(
  context: MatcherContext,
  name: string,
  actual: AudioBus,
  expected: AudioBus,
  sampleRate: number,
): string | undefined {
  try {
    const file = context.testPath!;
    const root = inject('soundorE2E')?.root ?? process.cwd();
    const dir = join(
      resultsDir(root, file, context.currentTestName ?? basename(file)),
      name.replace(/[^\w.-]+/g, '-'),
    );
    writeWav(join(dir, 'actual.wav'), { sampleRate, channels: actual });
    writeWav(join(dir, 'expected.wav'), { sampleRate, channels: expected });
    return dir;
  } catch {
    return undefined;
  }
}

// One test's unnamed snapshots, in order.
const unnamed = new Map<string, number>();

export const audioMatchers = {
  toBeSilent(
    this: MatcherContext,
    received: unknown,
    { threshold = 0.000001 }: SilenceOptions = {},
  ) {
    const loudest = peak(bus(received, 'toBeSilent'));
    return {
      pass: loudest <= threshold,
      message: () =>
        this.isNot
          ? `Expected sound above ${threshold}: the peak is ${loudest}`
          : `Expected silence: the peak is ${loudest}, above ${threshold}`,
    };
  },

  toBeCloseToAudio(
    this: MatcherContext,
    received: unknown,
    expected: unknown,
    options: AudioMatcherOptions = {},
  ) {
    const actual = bus(received, 'toBeCloseToAudio');
    const wanted = bus(expected, 'toBeCloseToAudio');
    const { tolerance = TOLERANCE, sampleRate = SAMPLE_RATE } = options;
    const found = difference(actual, wanted, tolerance);
    if (found === undefined)
      return {
        ...ok,
        message: () =>
          `Expected different audio: it is the same within ${tolerance}`,
      };
    const dir = this.isNot
      ? undefined
      : keep(this, 'audio', actual, wanted, sampleRate);
    return {
      pass: false,
      message: () =>
        `Expected the same audio: ${found}${dir ? `\nListen to both: ${dir}` : ''}`,
    };
  },

  toMatchAudioSnapshot(
    this: MatcherContext,
    received: unknown,
    name?: string,
    options: AudioMatcherOptions = {},
  ) {
    const actual = bus(received, 'toMatchAudioSnapshot');
    if (this.isNot)
      throw new TypeError(
        'toMatchAudioSnapshot has no .not: audio can differ in too many ways to mean anything',
      );
    const { tolerance = TOLERANCE, sampleRate = SAMPLE_RATE } = options;
    const file = this.testPath!;
    const test = this.currentTestName ?? basename(file);
    let snapshot = name;
    if (snapshot === undefined) {
      const count = (unnamed.get(test) ?? 0) + 1;
      unnamed.set(test, count);
      snapshot = count === 1 ? test : `${test} ${count}`;
    }
    const safeName = snapshot.replace(/[^\w.-]+/g, '-');
    const path = join(
      dirname(file),
      '__snapshots__',
      basename(file),
      `${safeName}.wav`,
    );
    // Vitest's -u, and no new snapshots on CI, as for its own snapshots.
    const update =
      (this.snapshotState as { _updateSnapshot?: UpdateMode } | undefined)
        ?._updateSnapshot ?? (process.env['CI'] ? 'none' : 'new');
    if (update === 'all' || (update === 'new' && !existsSync(path))) {
      writeWav(path, { sampleRate, channels: actual });
      return ok;
    }
    if (!existsSync(path))
      return {
        pass: false,
        message: () =>
          `There is no saved audio ${path}, and on CI none is written. Run the test once where it can be, and commit it.`,
      };
    const saved = readWav(path);
    const found = difference(actual, saved.channels, tolerance);
    if (found === undefined) return ok;
    const dir = keep(this, safeName, actual, saved.channels, saved.sampleRate);
    return {
      pass: false,
      message: () =>
        `The audio does not match ${path}: ${found}${dir ? `\nListen to both: ${dir}` : ''}\nIf the change is right, run Vitest with -u.`,
    };
  },
};
