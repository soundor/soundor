// What lasts beyond one look at the editor: the saved session (parameters
// and the UI's state), factory presets (parameters and audio state), the
// editor closed and opened again, and instances that do not share a thing.
import { launchPlugin, noise } from '@soundor/vitest-e2e';
import { expect, test } from 'vitest';

import { normalized, valueText } from '../support/plugin';

test('a saved session comes back in the UI of a new instance', async () => {
  const first = await launchPlugin();
  await first.parameter('Gain').set(0.25);
  const note = first.getByRole('textinput', { name: 'Note' });
  await note.type('saved with the session');
  await note.press('Enter');
  await expect(first.getByDebugId('note')).toHaveText(
    'Note: saved with the session',
  );
  const state = await first.host.getState();

  const second = await launchPlugin();
  await expect(second.getByDebugId('note')).toHaveText('Note: none');
  await second.host.setState(state);

  await expect
    .poll(valueText(second.getByRole('adjustable', { name: 'Gain' })))
    .toBe('0.50x');
  await expect(second.getByDebugId('note')).toHaveText(
    'Note: saved with the session',
  );
});

test('a factory preset sets parameters, the UI state and the audio state', async () => {
  const plugin = await launchPlugin();

  await plugin.getByRole('button', { name: 'Quiet invert' }).click();

  await expect(plugin.getByDebugId('preset.current')).toHaveText(
    'Quiet invert',
  );
  await expect(plugin.getByDebugId('note')).toHaveText('Note: Quiet invert');
  await expect.poll(normalized(plugin, 'Mode')).toBe(1);
  expect(await normalized(plugin, 'Gain')()).toBeCloseTo(0.25, 5);
  // Gain 0.5, level 0.5, inverted.
  const input = noise({ seconds: 0.1, amplitude: 0.5, seed: 2 });
  const { outputs } = await plugin.host.process({ inputs: [[input, input]] });
  expect(outputs[0]![0]).toBeCloseToAudio(
    input.map((sample) => -0.25 * sample),
  );

  // Changed after, it is still the preset, modified.
  await plugin.parameter('Gain').set(0.5);
  await expect(plugin.getByDebugId('preset.current')).toHaveText(
    'Quiet invert (modified)',
  );
});

test('the editor closed and opened again shows the plugin as it is', async () => {
  const plugin = await launchPlugin();
  await plugin.getByRole('button', { name: 'Count later' }).click();
  await expect(plugin.getByDebugId('native.count')).toHaveText('Counted 1');

  await plugin.host.closeEditor();
  await plugin.parameter('Gain').set(0.75);
  await plugin.openEditor();

  await expect
    .poll(valueText(plugin.getByRole('adjustable', { name: 'Gain' })))
    .toBe('1.50x');
  // The controller outlives the editor; the UI's own React state does not.
  await expect(plugin.getByDebugId('native.count')).toHaveText('Not counted');
  await plugin.getByRole('button', { name: 'Count later' }).click();
  await expect(plugin.getByDebugId('native.count')).toHaveText('Counted 2');
});

test('every editor opened again is a working one', async () => {
  const plugin = await launchPlugin();
  const bypass = plugin.getByRole('togglebutton', { name: 'Bypass' });

  for (let round = 1; round <= 5; round += 1) {
    await plugin.host.closeEditor();
    await plugin.openEditor();

    await bypass.click();
    await expect.poll(normalized(plugin, 'Bypass')).toBe(round % 2);
    await expect(plugin.getByDebugId('checks')).toHaveText(/passed$/, {
      timeout: 10_000,
    });
  }
});

test('two instances keep apart', async () => {
  const first = await launchPlugin();
  const second = await launchPlugin();

  await first.getByRole('togglebutton', { name: 'Bypass' }).click();
  await first.getByRole('button', { name: 'Count later' }).click();

  await expect(first.getByDebugId('native.count')).toHaveText('Counted 1');
  await expect.poll(normalized(first, 'Bypass')).toBe(1);
  expect(await normalized(second, 'Bypass')()).toBe(0);
  await second.getByRole('button', { name: 'Count later' }).click();
  await expect(second.getByDebugId('native.count')).toHaveText('Counted 1');
});
