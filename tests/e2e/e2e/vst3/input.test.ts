// Input as the engine dispatches it, as a platform's would be (the Driver
// sends it through the engine's own hit testing, never by calling
// handlers): presses, drags, the wheel, keys, focus and typing, and the
// parameter changes they make reaching the host.
import { launchPlugin } from '@soundor/vitest-e2e';
import { expect, test } from 'vitest';

import { normalized, valueText } from '../support/plugin';

test('a press toggles a parameter, and the host sees it', async () => {
  const plugin = await launchPlugin();
  const bypass = plugin.getByRole('togglebutton', { name: 'Bypass' });
  await expect(bypass).not.toBeChecked();

  await bypass.click();

  await expect(bypass).toBeChecked();
  await expect(plugin.getByText('Bypassed')).toBeVisible();
  await expect.poll(normalized(plugin, 'Bypass')).toBe(1);
});

test('a radio chooses a choice parameter', async () => {
  const plugin = await launchPlugin();
  const invert = plugin.getByRole('radio', { name: 'Invert' });

  await invert.click();

  await expect(invert).toBeChecked();
  await expect(plugin.getByRole('radio', { name: 'Clean' })).not.toBeChecked();
  await expect.poll(normalized(plugin, 'Mode')).toBe(1);
});

test('dragging the slider changes its parameter by the distance', async () => {
  const plugin = await launchPlugin();
  const slider = plugin.getByRole('adjustable', { name: 'Gain' });

  // 240 pixels are the whole range, 0 to 2.
  await slider.drag({ deltaX: 60 });

  await expect.poll(valueText(slider)).toBe('1.50x');
  expect(await normalized(plugin, 'Gain')()).toBeCloseTo(0.75, 5);
});

test('the wheel turns the slider', async () => {
  const plugin = await launchPlugin();
  const slider = plugin.getByRole('adjustable', { name: 'Gain' });

  await slider.scroll({ deltaY: -100 });

  await expect.poll(valueText(slider)).toBe('1.10x');
});

test('keys reach the focused control, and Home restores the default', async () => {
  const plugin = await launchPlugin();
  const slider = plugin.getByRole('adjustable', { name: 'Gain' });

  await slider.press('ArrowRight');
  await expect(slider).toHaveFocus();
  await expect.poll(valueText(slider)).toBe('1.02x');
  await slider.press('Home');
  await expect.poll(valueText(slider)).toBe('1.00x');
});

test('Tab moves focus to the next control', async () => {
  const plugin = await launchPlugin();
  await plugin.getByRole('togglebutton', { name: 'Bypass' }).focus();

  await plugin.keyboard.press('Tab');

  await expect(plugin.getByRole('button', { name: 'Unity' })).toHaveFocus();
  await plugin.keyboard.press('Shift+Tab');
  await expect(
    plugin.getByRole('togglebutton', { name: 'Bypass' }),
  ).toHaveFocus();
});

test('typing edits a text input, and Enter submits it', async () => {
  const plugin = await launchPlugin();
  const note = plugin.getByRole('textinput', { name: 'Note' });

  await note.type('Ünïcode ✓ note');
  await note.press('Enter');

  await expect(plugin.getByDebugId('note')).toHaveText('Note: Ünïcode ✓ note');
});

test('host automation moves the control', async () => {
  const plugin = await launchPlugin();

  await plugin.parameter('Gain').set(0.25);

  await expect
    .poll(valueText(plugin.getByRole('adjustable', { name: 'Gain' })))
    .toBe('0.50x');
});

test('the wheel scrolls a list, clipped to its box', async () => {
  const plugin = await launchPlugin();
  const list = plugin.getByDebugId('scroll.list');
  const box = await list.getBounds();
  const first = await plugin.getByDebugId('scroll.row.1').getBounds();
  const last = plugin.getByDebugId('scroll.row.40');
  expect((await last.getBounds()).y).toBeGreaterThan(box.y + box.height);

  await list.scroll({ deltaY: 100 });

  await expect
    .poll(async () => (await plugin.getByDebugId('scroll.row.1').getBounds()).y)
    .toBeLessThan(first.y);

  // Past the end, the last row comes to rest inside the box.
  await list.scroll({ deltaY: 2000 });
  await expect
    .poll(async () => {
      const row = await last.getBounds();
      return row.y >= box.y && row.y + row.height <= box.y + box.height + 1;
    })
    .toBe(true);
});
