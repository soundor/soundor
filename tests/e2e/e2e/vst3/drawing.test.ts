// Cross-runtime drawing: the tiles of src/rendering/drawing.tsx as the
// native renderer draws them (the Debug VST3 in the VST3 host) and as the
// browser draws them (the web build, the engine's DOM adapter, in
// Chromium), at device scales where a logical pixel is not a whole number
// of device pixels. Text is left out: the two rasterize glyphs their own way.
//
// The browser runs headed at a real device scale
// (--force-device-scale-factor), not with Playwright's emulated one: the
// emulation puts edges on CSS pixels and scales the result, which no
// display does. Linux only: the host fixes an editor's scale on Linux and
// Windows, and only Linux's E2E job installs Chromium.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';
import { launchPlugin } from '@soundor/vitest-e2e';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { drawingTiles } from '../../src/rendering/drawing-tiles';
import { decodePng, type Pixels } from '../support/pixels';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORT = 4177;
const SCALES = [1.25, 1.375, 1.5];
/** A channel this far apart is a different pixel, not antialiasing. */
const DIFFERENT = 64;
/** Pixels of a tile that may differ: where a curve's antialiasing does. */
const ALLOWED = 6;

let server: ChildProcess | undefined;

describe.skipIf(process.platform !== 'linux')('drawing', () => {
  beforeAll(async () => {
    const built = spawnSync('pnpm', ['exec', 'soundor', 'build', 'web'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    if (built.status !== 0)
      throw new Error(
        `soundor build web failed:\n${built.stdout}${built.stderr}`,
      );
    server = spawn(process.execPath, ['scripts/serve.ts', String(PORT)], {
      cwd: ROOT,
      stdio: 'ignore',
    });
    for (let tries = 0; ; tries++) {
      const served = await fetch(`http://127.0.0.1:${PORT}/`).catch(() => null);
      if (served?.ok) break;
      if (tries > 100) throw new Error('the web build is not served');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }, 300_000);

  afterAll(() => {
    server?.kill();
  });

  test.each(SCALES)(
    'the browser draws each tile as the native renderer does, at %s',
    async (scale) => {
      const plugin = await launchPlugin();
      await plugin.host.closeEditor();
      await plugin.openEditor({ scale });
      const shot = await plugin.screenshot();
      expect(shot.scale).toBe(scale);
      const native = decodePng(shot.data, shot.scale);
      const tiles = await Promise.all(
        drawingTiles.map((_, index) =>
          plugin.getByDebugId(`drawing.${index}`).getBounds(),
        ),
      );

      const web = await inBrowser(scale);

      const report: string[] = [];
      for (const [index, name] of drawingTiles.entries()) {
        const tile = tiles[index]!;
        const left = Math.round(tile.x * scale);
        const top = Math.round(tile.y * scale);
        const width = Math.round(tile.width * scale);
        const height = Math.round(tile.height * scale);
        let different = 0;
        for (let y = top; y < top + height; y++)
          for (let x = left; x < left + width; x++) {
            const a = native.at(x, y);
            const b = web.at(x, y);
            if (
              Math.max(
                Math.abs(a[0] - b[0]),
                Math.abs(a[1] - b[1]),
                Math.abs(a[2] - b[2]),
              ) > DIFFERENT
            )
              different++;
          }
        if (different > ALLOWED)
          report.push(`${name}: ${different} of ${width * height} pixels`);
      }
      expect(report, 'tiles drawn differently').toEqual([]);
    },
    120_000,
  );
});

/** The view as headed Chromium draws it at `scale`, from its top left corner. */
async function inBrowser(scale: number): Promise<Pixels> {
  const browser = await chromium.launch({
    headless: false,
    args: [`--force-device-scale-factor=${scale}`, '--window-size=960,720'],
  });
  try {
    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/`);
    const last = page.locator(
      `[data-soundor-debug-id="drawing.${drawingTiles.length - 1}"]`,
    );
    await last.waitFor();
    expect(await page.evaluate(() => devicePixelRatio)).toBe(scale);
    const root = (await page.locator('.sd-root').first().boundingBox())!;
    // The view at its own size: the page does not scale it to fit.
    expect(root.width).toBeCloseTo(720, 3);
    const pixels = decodePng(await page.screenshot(), scale);
    const left = Math.round(root.x * scale);
    const top = Math.round(root.y * scale);
    return { ...pixels, at: (x, y) => pixels.at(x + left, y + top) };
  } finally {
    await browser.close();
  }
}
