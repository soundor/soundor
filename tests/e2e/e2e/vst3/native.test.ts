// The plugin's Rust, called from its UI: the controller's methods (sync and
// async, on the control thread) and events, and the processor's streams
// from the audio thread to the UI.
import { launchPlugin, sine } from '@soundor/vitest-e2e';
import { expect, test } from 'vitest';

test('a synchronous method takes and returns a string', async () => {
  const plugin = await launchPlugin();
  const input = plugin.getByRole('textinput', { name: 'Text to reverse' });

  await input.type('Soundor ✓ 🎛');
  await plugin.getByRole('button', { name: 'Reverse' }).click();

  await expect(plugin.getByDebugId('native.reversed')).toHaveText(
    'Reversed: 🎛 ✓ rodnuoS',
  );
});

test('an async method settles, after its event arrives', async () => {
  const plugin = await launchPlugin();
  const count = plugin.getByRole('button', { name: 'Count later' });

  await count.click();
  await expect(plugin.getByDebugId('native.count')).toHaveText('Counted 1');
  await expect(plugin.getByDebugId('native.event')).toHaveText('Event 1');

  // The controller's local store lasts between calls.
  await count.click();
  await expect(plugin.getByDebugId('native.count')).toHaveText('Counted 2');
  await expect(plugin.getByDebugId('native.event')).toHaveText('Event 2');
});

test('the processor streams what it played to the UI', async () => {
  const plugin = await launchPlugin();
  await expect(plugin.getByDebugId('native.peak')).toHaveText('Peak none');
  await plugin.parameter('Gain').set(0.25);

  const tone = sine(1000, { seconds: 0.1, amplitude: 0.8 });
  await plugin.host.process({ inputs: [[tone, tone]] });

  // Gain 0.5 (0.25 normalized): the peak of the last block is 0.4.
  await expect(plugin.getByDebugId('native.peak')).toHaveText('Peak 0.400');
  await expect(plugin.getByDebugId('native.scope')).toHaveText(
    /^Scope 64 samples, first -?0\.\d{3}$/,
  );
});
