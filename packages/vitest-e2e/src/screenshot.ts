import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

import type { MatcherOptions } from './matchers';

/** Options of `toMatchScreenshot`. */
export interface ScreenshotMatcherOptions extends MatcherOptions {
  /** How different one pixel may be and still count as the same, from 0 to 1
      (0.1 by default). */
  threshold?: number;
  /** How many pixels may differ (0 by default). */
  maxDiffPixels?: number;
  /** What share of the pixels may differ, from 0 to 1 (0 by default). */
  maxDiffRatio?: number;
}

/** Vitest's snapshot modes: `-u` is `all`, on CI nothing new is written. */
export type UpdateMode = 'all' | 'new' | 'none';

export interface ScreenshotComparison extends ScreenshotMatcherOptions {
  capture(options: { timeout: number }): Promise<{ data: Uint8Array }>;
  /** The saved image. */
  baseline: string;
  /** Where the actual image and the differences go when they do not match. */
  results: string;
  update: UpdateMode;
}

const TIMEOUT = 5000;
const CAPTURE_TIMEOUT = 2000;
const DELAYS = [0, 50, 100, 250];

interface Difference {
  pixels: number;
  ratio: number;
  /** The image of the differences; none for images of different sizes. */
  image?: Buffer;
  size?: string;
}

function difference(
  expected: Uint8Array,
  actual: Uint8Array,
  threshold: number,
): Difference {
  const a = PNG.sync.read(Buffer.from(expected));
  const b = PNG.sync.read(Buffer.from(actual));
  const total = b.width * b.height;
  if (a.width !== b.width || a.height !== b.height)
    return {
      pixels: total,
      ratio: 1,
      size: `the size is ${b.width}x${b.height}, not ${a.width}x${a.height}`,
    };
  const diff = new PNG({ width: b.width, height: b.height });
  const pixels = pixelmatch(a.data, b.data, diff.data, b.width, b.height, {
    threshold,
  });
  return {
    pixels,
    ratio: total === 0 ? 0 : pixels / total,
    image: PNG.sync.write(diff),
  };
}

async function save(path: string, data: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
}

/**
 * Captures until the view matches the saved image, or `timeout`. With nothing
 * saved, waits until two captures in a row agree, so that an image taken in
 * the middle of a change is never what later runs are held to.
 */
export async function compareScreenshot(options: ScreenshotComparison) {
  const {
    capture,
    baseline,
    results,
    update,
    timeout = TIMEOUT,
    threshold = 0.1,
    maxDiffPixels = 0,
    maxDiffRatio = 0,
  } = options;
  const saved = existsSync(baseline) ? await readFile(baseline) : undefined;
  if (saved === undefined && update === 'none')
    return {
      pass: false,
      message: () =>
        `There is no saved screenshot ${baseline}, and on CI none is written. Run the test once where it can be, and commit it.`,
    };

  const deadline = Date.now() + timeout;
  let previous: Uint8Array | undefined;
  let last!: Uint8Array;
  let found: Difference | undefined;
  for (let attempt = 0; ; ++attempt) {
    ({ data: last } = await capture({
      timeout: Math.max(deadline - Date.now(), CAPTURE_TIMEOUT),
    }));
    if (saved === undefined || update === 'all') {
      const steady =
        previous !== undefined && difference(previous, last, 0).pixels === 0;
      if (steady) {
        await save(baseline, last);
        return { pass: true, message: () => '' };
      }
      previous = last;
    } else {
      found = difference(saved, last, threshold);
      if (
        found.size === undefined &&
        (found.pixels <= maxDiffPixels || found.ratio <= maxDiffRatio)
      )
        return { pass: true, message: () => '' };
    }
    const wait = DELAYS[Math.min(attempt, DELAYS.length - 1)]!;
    if (Date.now() + wait >= deadline) break;
    await new Promise((settled) => setTimeout(settled, wait));
  }

  if (found === undefined)
    return {
      pass: false,
      message: () =>
        `The view did not settle within ${timeout} ms, so ${baseline} was not written`,
    };
  const actual = join(results, 'actual.png');
  await save(actual, last);
  await save(join(results, 'expected.png'), saved!);
  if (found.image) await save(join(results, 'diff.png'), found.image);
  const { pixels, ratio, size } = found;
  return {
    pass: false,
    message: () =>
      `The screenshot does not match ${baseline} within ${timeout} ms: ${size ?? `${pixels} pixels differ (${(ratio * 100).toFixed(2)}%)`}.\nSee ${results}. If the change is right, run Vitest with -u.`,
  };
}
