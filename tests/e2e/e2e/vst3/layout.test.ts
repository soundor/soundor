// Layout (Yoga, in the engine) as the editor shows it: fixed boxes, rows
// with gaps, and flexbox filling the view again when the host resizes it.
import { launchPlugin } from '@soundor/vitest-e2e';
import { expect, test } from 'vitest';

test('fixed boxes keep their size, in a row with its gap', async () => {
  const plugin = await launchPlugin();
  const view = await plugin.getByDebugId('swatch.view').getBounds();
  const canvas = await plugin.getByDebugId('swatch.canvas').getBounds();
  expect(view).toMatchObject({ width: 48, height: 48 });
  expect(canvas).toMatchObject({ width: 48, height: 48, y: view.y });
  // 48 wide, then a gap of 12.
  expect(canvas.x - view.x).toBe(60);
});

test('the UI fills the view at the size the host opens it', async () => {
  const plugin = await launchPlugin();
  expect(await plugin.getByDebugId('app').getBounds()).toMatchObject({
    x: 0,
    y: 0,
    width: 720,
    height: 540,
  });
  await expect(plugin.getByDebugId('view.size')).toHaveText('720×540');
  // The bottom row takes the rest, inside the padding of 10.
  const bottom = await plugin.getByDebugId('app.bottom').getBounds();
  expect(bottom.y + bottom.height).toBe(530);
  expect(bottom.width).toBe(700);
});

test('resizing lays the UI out again: what flexes grows, the rest stays', async () => {
  const plugin = await launchPlugin();
  const before = await plugin.getByDebugId('app.bottom').getBounds();
  const swatch = await plugin.getByDebugId('swatch.view').getBounds();

  await plugin.host.resizeEditor(960, 720);

  // The editor takes the new size in its own time, after the call returns.
  await expect(plugin.getByDebugId('view.size')).toHaveText('960×720');
  const after = await plugin.getByDebugId('app.bottom').getBounds();
  expect(after.width).toBe(before.width + 240);
  expect(after.height).toBe(before.height + 180);
  expect(await plugin.getByDebugId('swatch.view').getBounds()).toEqual(swatch);
  const shot = await plugin.screenshot();
  expect(shot.width).toBe(Math.round(960 * shot.scale));
});

test('the host cannot make the editor smaller than its minimum', async () => {
  const plugin = await launchPlugin();

  const editor = await plugin.host.resizeEditor(200, 100);

  expect(editor).toMatchObject({ width: 480, height: 360 });
  await expect(plugin.getByDebugId('view.size')).toHaveText('480×360');
});
