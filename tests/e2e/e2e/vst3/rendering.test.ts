// What the engine draws, read back from its captures: one opaque color by
// each way it draws (a view's style, a 2D canvas, a WebGL 2 canvas, an SVG
// image), and text, with the CPU compositor and with the one the platform
// chooses (the GPU's where there is one).
import { launchPlugin } from '@soundor/vitest-e2e';
import { describe, expect, test } from 'vitest';

import { capture, coverage, distinctColors } from '../support/pixels';

const swatches = {
  'swatch.view': '#ff0000',
  'swatch.canvas': '#00ff00',
  'swatch.image': '#ff00ff',
} as const;

/** CI sets it where the runner has a GPU for WebGL, as the engine's tests. */
const requireGpu = process.env['SOUNDOR_REQUIRE_GPU'] === '1';

describe.each([
  { renderer: 'auto', env: {} },
  { renderer: 'cpu', env: { SOUNDOR_RENDERER: 'cpu' } },
])('with the $renderer compositor', ({ renderer, env }) => {
  test('the debug badge names the compositor drawing', async () => {
    const plugin = await launchPlugin({
      env: { ...env, SOUNDOR_SHOW_RENDERER: '1' },
    });
    const badge = plugin.getByDebugId('soundor.renderer');
    await expect(badge).toHaveText(
      renderer === 'cpu' ? 'CPU composition' : /^(GPU|CPU) composition$/,
    );
  });

  test.each(Object.entries(swatches))(
    '%s is drawn in its color',
    async (id, color) => {
      const plugin = await launchPlugin({ env });
      await expect
        .poll(async () =>
          coverage(await capture(plugin.getByDebugId(id)), color),
        )
        .toBe(1);
    },
  );

  test('swatch.webgl is drawn in its color, where there is WebGL 2', async () => {
    const plugin = await launchPlugin({ env });
    const status = plugin.getByDebugId('webgl.status');
    await expect(status).toHaveText(/^(WebGL 2|No WebGL)$/);
    const available = (await status.getNode()).text === 'WebGL 2';
    expect(available || !requireGpu, 'WebGL 2 is required here').toBe(true);

    await expect
      .poll(async () =>
        available
          ? coverage(
              await capture(plugin.getByDebugId('swatch.webgl')),
              '#0000ff',
            )
          : 1,
      )
      .toBe(1);
  });

  test('text is drawn, antialiased', async () => {
    const plugin = await launchPlugin({ env });
    const sample = plugin.getByDebugId('text.sample');
    await expect(sample).toBeVisible();
    const bounds = await sample.getBounds();
    // Measured: wider than tall, and as tall as a 13 px line.
    expect(bounds.width).toBeGreaterThan(150);
    expect(bounds.height).toBeGreaterThan(12);
    expect(bounds.height).toBeLessThan(24);
    expect(distinctColors(await capture(sample))).toBeGreaterThan(8);
  });
});

test('a capture is the size of the view, at its scale', async () => {
  const plugin = await launchPlugin();
  const shot = await plugin.screenshot();
  expect(shot).toMatchObject({
    width: Math.round(720 * shot.scale),
    height: Math.round(540 * shot.scale),
  });
});
