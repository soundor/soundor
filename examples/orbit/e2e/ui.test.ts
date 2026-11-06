import { launchPlugin, noise, peak } from '@soundor/vitest-e2e';
import { expect, test } from 'vitest';

type Plugin = Awaited<ReturnType<typeof launchPlugin>>;

/** What a knob or an echo handle says it is set to, as a screen reader hears. */
const shown = (plugin: Plugin, name: string) => async () => {
  const { value } = await plugin
    .getByRole('adjustable', { name })
    .getAccessibility();
  return (value as { text?: string } | undefined)?.text;
};

const normalized = (plugin: Plugin, title: string) => async () =>
  (await plugin.parameter(title).get()).normalized;

test('Hold reaches the processor and shows it is held', async () => {
  const plugin = await launchPlugin();
  const hold = plugin.getByRole('togglebutton', { name: 'Hold' });
  await expect(hold).not.toBeChecked();

  await hold.click();

  await expect(hold).toBeChecked();
  await expect(plugin.getByText('Release to let sound in')).toBeVisible();
  await expect.poll(normalized(plugin, 'Hold')).toBe(1);
});

test('dragging a knob up raises its parameter', async () => {
  const plugin = await launchPlugin();

  // 160 pixels are the knob's whole range.
  await plugin
    .getByRole('adjustable', { name: 'Feedback' })
    .drag({ deltaY: -40 });

  await expect.poll(shown(plugin, 'Feedback')).toBe('71%');
  expect(await normalized(plugin, 'Feedback')()).toBeCloseTo(
    0.48 / 0.92 + 0.25,
  );
});

test('a knob takes the keyboard, and Home restores its default', async () => {
  const plugin = await launchPlugin();
  const mix = plugin.getByRole('adjustable', { name: 'Mix' });

  await mix.press('ArrowUp');
  await expect(mix).toHaveFocus();
  await expect.poll(shown(plugin, 'Mix')).toBe('61%');
  await mix.press('Home');
  await expect.poll(shown(plugin, 'Mix')).toBe('60%');
});

test('dragging an echo changes its time and its level', async () => {
  const plugin = await launchPlugin();

  await plugin
    .getByRole('adjustable', { name: 'Echo 1 time' })
    .drag({ deltaX: 110, deltaY: 45 });

  // Tempo sync snaps time to 1/32 notes: 0.75 + 110 / 660 * 3 beats.
  await expect
    .poll(normalized(plugin, 'Echo 1 time'))
    .toBeCloseTo((1.25 - 0.125) / 2.875);
  expect(await normalized(plugin, 'Echo 1 level')()).toBeLessThan(0.8);
});

test('automation from the host moves the knob', async () => {
  const plugin = await launchPlugin();

  await plugin.parameter('Mix').set(0.25);

  await expect.poll(shown(plugin, 'Mix')).toBe('25%');
});

test('a preset sets the parameters the processor reads', async () => {
  const plugin = await launchPlugin();
  await plugin.getByRole('togglebutton', { name: 'Hold' }).click();

  await plugin.getByRole('button', { name: 'Next preset' }).click();

  await expect(plugin.getByText('Warm magnetic')).toBeVisible();
  await expect(plugin.getByText('FREE')).toBeVisible();
  await expect.poll(normalized(plugin, 'Hold')).toBe(0);
  expect(await normalized(plugin, 'Tempo sync')()).toBe(0);
  expect(await normalized(plugin, 'Echo 1 time')()).toBeCloseTo(
    (0.38 - 0.125) / 2.875,
  );
});

test('Original lets the input through, and the delay keeps running', async () => {
  const plugin = await launchPlugin();
  const original = plugin.getByRole('radio', { name: 'Original' });

  await original.click();
  await expect(original).toBeChecked();
  await expect(plugin.getByText('Bypassed · original audio')).toBeVisible();
  await expect.poll(normalized(plugin, 'Bypass')).toBe(1);

  const input = noise({ seconds: 0.5, amplitude: 0.5, seed: 1 });
  const dry = await plugin.host.process({ inputs: [[input, input]] });
  expect(dry.outputs[0]![0]).toBeCloseToAudio(input);

  await plugin.getByRole('radio', { name: 'Orbit' }).click();
  await expect.poll(normalized(plugin, 'Bypass')).toBe(0);

  // Nothing comes in now: this is what went in while it was bypassed.
  const echoes = await plugin.host.process({ frames: 48_000 });
  expect(peak(echoes.outputs[0]!)).toBeGreaterThan(0.01);
});

test('resizing zooms the plugin: nothing moves, and it still takes input', async () => {
  const plugin = await launchPlugin();
  const hold = plugin.getByRole('togglebutton', { name: 'Hold' });
  const before = await hold.getBounds();
  expect(await plugin.screenshot()).toMatchObject({ width: 800, height: 600 });

  await plugin.host.resizeEditor(1600, 1200);

  // The editor takes the new size in its own time, after the call returns.
  await expect.poll(async () => (await plugin.screenshot()).width).toBe(1600);
  expect(await plugin.screenshot()).toMatchObject({ height: 1200, scale: 2 });
  // Layout rounds to device pixels, so it can move by less than one of the old.
  const after = await hold.getBounds();
  expect(Math.abs(after.x - before.x)).toBeLessThan(1);
  expect(Math.abs(after.y - before.y)).toBeLessThan(1);
  expect(after.width).toBe(before.width);
  await hold.click();
  await expect(hold).toBeChecked();
});

test('a saved session comes back in the UI of a new instance', async () => {
  const first = await launchPlugin();
  await first.getByRole('togglebutton', { name: 'Hold' }).click();
  await first.parameter('Mix').set(0.25);
  await expect.poll(shown(first, 'Mix')).toBe('25%');
  const state = await first.host.getState();

  const second = await launchPlugin();
  await expect.poll(shown(second, 'Mix')).toBe('60%');
  await second.host.setState(state);

  await expect.poll(shown(second, 'Mix')).toBe('25%');
  await expect(
    second.getByRole('togglebutton', { name: 'Hold' }),
  ).toBeChecked();
});

test('the tempo the host plays at shows in the plugin', async () => {
  const plugin = await launchPlugin();

  await plugin.host.process({
    frames: 512,
    transport: { playing: true, tempo: 90 },
  });

  await expect(plugin.getByText('90 BPM')).toBeVisible();
});
