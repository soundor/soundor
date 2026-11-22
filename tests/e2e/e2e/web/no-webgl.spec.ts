// Without WebGL 2 (none, or a context whose shaders fail), the plugin says
// so and everything else still draws and works.
import { expect, test } from '@playwright/test';

import { coverage, decodePng } from '../support/pixels';
import { byDebugId, openPlugin } from './plugin';

test('without WebGL 2 the rest still draws and works', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value: function (
        this: HTMLCanvasElement,
        kind: string,
        options?: unknown,
      ) {
        if (kind === 'webgl2') return null;
        return Reflect.apply(original, this, [kind, options]);
      },
    });
  });
  await openPlugin(page);

  await expect(byDebugId(page, 'webgl.status')).toHaveText('No WebGL');
  await expect
    .poll(async () =>
      coverage(
        decodePng(await byDebugId(page, 'swatch.canvas').screenshot()),
        '#00ff00',
      ),
    )
    .toBe(1);
  const bypass = page.getByRole('button', { name: 'Bypass', exact: true });
  await bypass.click();
  await expect(bypass).toHaveAttribute('aria-pressed', 'true');
});
