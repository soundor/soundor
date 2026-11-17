// Run after build:juce: the same Rust synth as the browser, in a real VST3.
import assert from 'node:assert/strict';
import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { launchHost, midiInput } from '@soundor/vst3-host';
const root = fileURLToPath(new URL('..', import.meta.url));
const plugin =
  process.argv[2] ??
  globSync('.soundor/dist/juce/**/*.vst3', { cwd: root }).map(
    (path) => `${root}/${path}`,
  )[0];
assert.ok(plugin, 'Build the piano VST3 first');
for (const blockSize of [64, 512]) {
  const host = await launchHost({ plugin, sampleRate: 48000, blockSize });
  try {
    const note = (velocity, sampleOffset) =>
      midiInput({
        message: { type: 'noteOn', channel: 1, note: 69, velocity },
        sampleOffset,
      });
    const onset = await host.process({ frames: 128, events: [note(100, 17)] });
    assert.deepEqual(onset.warnings, []);
    const left = onset.outputs[0][0];
    assert.ok(left.slice(0, 18).every((sample) => sample === 0));
    assert.ok(left.slice(18).some((sample) => Math.abs(sample) > 0.001));
    assert.deepEqual(onset.events, [], 'Synth must not echo input MIDI');
    const release = await host.process({ frames: 128, events: [note(0, 23)] });
    assert.ok(
      release.outputs[0][0]
        .slice(0, 23)
        .some((sample) => Math.abs(sample) > 0.001),
    );
    assert.ok(release.outputs[0][0].slice(23).every((sample) => sample === 0));
    await host.sendMidi({
      type: 'noteOn',
      channel: 1,
      note: 69,
      velocity: 100,
    });
    const virtual = await host.process({ frames: 128 });
    assert.ok(virtual.outputs[0][0].some((sample) => Math.abs(sample) > 0.001));
    await host.reset();
    const reset = await host.process({ frames: 128 });
    assert.ok(
      reset.outputs.every((bus) =>
        bus.every((channel) => channel.every((sample) => sample === 0)),
      ),
    );
    console.log(
      `Piano VST3: exact onset, zero-velocity release, virtual input and silent reset at block size ${blockSize}`,
    );
  } finally {
    await host.close();
  }
}
