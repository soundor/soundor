import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { compareScreenshot, type UpdateMode } from './screenshot';

function image(red: number, { width = 4, height = 4, changed = 16 } = {}) {
  const png = new PNG({ width, height });
  for (let pixel = 0; pixel < width * height; ++pixel) {
    png.data[pixel * 4] = pixel < changed ? red : 0;
    png.data[pixel * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

let dir: string;
let baseline: string;
let results: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'soundor-vitest-e2e-shot-'));
  baseline = join(dir, '__screenshots__', 'a.test.ts', 'view-linux.png');
  results = join(dir, 'results');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function saved(data: Uint8Array) {
  await mkdir(dirname(baseline), { recursive: true });
  await writeFile(baseline, data);
}

/** Captures that show each image in turn, then stay on the last. */
function showing(...images: Uint8Array[]) {
  let next = 0;
  return vi.fn<() => Promise<{ data: Uint8Array<ArrayBufferLike> }>>(
    async () => ({
      data: images[Math.min(next++, images.length - 1)]!,
    }),
  );
}

function compare(
  capture: ReturnType<typeof showing>,
  update: UpdateMode = 'new',
  options = {},
) {
  return compareScreenshot({
    capture,
    baseline,
    results,
    update,
    timeout: 200,
    ...options,
  });
}

describe('with no saved image', () => {
  test('saves one once two captures agree', async () => {
    const result = await compare(showing(image(10), image(200), image(200)));
    expect(result.pass).toBe(true);
    expect(readFileSync(baseline).equals(image(200))).toBe(true);
  });

  test('saves nothing from a view that never settles', async () => {
    let red = 0;
    const result = await compare(
      vi.fn(async () => ({ data: image((red += 40)) })),
    );
    expect(result.pass).toBe(false);
    expect(result.message()).toContain('did not settle');
    expect(existsSync(baseline)).toBe(false);
  });

  test('on CI fails instead, without capturing', async () => {
    const capture = showing(image(10));
    const result = await compare(capture, 'none');
    expect(result.pass).toBe(false);
    expect(result.message()).toContain('on CI none is written');
    expect(capture).not.toHaveBeenCalled();
    expect(existsSync(baseline)).toBe(false);
  });
});

describe('with a saved image', () => {
  test('passes when it matches, on CI too', async () => {
    await saved(image(10));
    for (const update of ['new', 'none'] as const)
      expect((await compare(showing(image(10)), update)).pass).toBe(true);
  });

  test('retries until the view matches', async () => {
    await saved(image(200));
    const capture = showing(image(0), image(0), image(200));
    expect((await compare(capture)).pass).toBe(true);
    expect(capture).toHaveBeenCalledTimes(3);
  });

  test('fails, leaving the images, and keeps what was saved', async () => {
    await saved(image(0));
    const result = await compare(showing(image(255)));
    expect(result.pass).toBe(false);
    expect(result.message()).toContain('16 pixels differ (100.00%)');
    expect(result.message()).toContain('run Vitest with -u');
    expect(readFileSync(baseline).equals(image(0))).toBe(true);
    expect(readFileSync(join(results, 'actual.png')).equals(image(255))).toBe(
      true,
    );
    expect(readFileSync(join(results, 'expected.png')).equals(image(0))).toBe(
      true,
    );
    expect(existsSync(join(results, 'diff.png'))).toBe(true);
  });

  test('says when the size changed', async () => {
    await saved(image(0));
    const result = await compare(
      showing(image(0, { width: 8, height: 2, changed: 0 })),
    );
    expect(result.pass).toBe(false);
    expect(result.message()).toContain('the size is 8x2, not 4x4');
    expect(existsSync(join(results, 'diff.png'))).toBe(false);
  });

  test('a size change passes no tolerance', async () => {
    await saved(image(0));
    const result = await compare(
      showing(image(0, { width: 8, height: 2, changed: 0 })),
      'new',
      { maxDiffRatio: 1, maxDiffPixels: 1000 },
    );
    expect(result.pass).toBe(false);
  });

  test('takes a number of pixels or a share of them', async () => {
    await saved(image(0));
    const twoRed = image(255, { changed: 2 });
    expect(
      (await compare(showing(twoRed), 'new', { maxDiffPixels: 1 })).pass,
    ).toBe(false);
    expect(
      (await compare(showing(twoRed), 'new', { maxDiffPixels: 2 })).pass,
    ).toBe(true);
    expect(
      (await compare(showing(twoRed), 'new', { maxDiffRatio: 0.125 })).pass,
    ).toBe(true);
  });

  test('a threshold lets a slight change through', async () => {
    await saved(image(0));
    const slight = image(10);
    expect((await compare(showing(slight), 'new', { threshold: 0 })).pass).toBe(
      false,
    );
    expect((await compare(showing(slight), 'new')).pass).toBe(true);
  });

  test('with -u replaces it', async () => {
    await saved(image(0));
    const result = await compare(showing(image(255)), 'all');
    expect(result.pass).toBe(true);
    expect(readFileSync(baseline).equals(image(255))).toBe(true);
  });
});
