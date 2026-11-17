// Run after build:juce. The real plugin generates MIDI with no audio buses.
import assert from 'node:assert/strict';
import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { launchHost, midiInput, midiOutput } from '@soundor/vst3-host';

const root = fileURLToPath(new URL('..', import.meta.url));
const plugin =
  process.argv[2] ??
  globSync('.soundor/dist/juce/**/*.vst3', { cwd: root }).map(
    (path) => `${root}/${path}`,
  )[0];
assert.ok(plugin, 'Build the arpeggiator VST3 first');
for (const blockSize of [64, 512]) {
  const host = await launchHost({ plugin, sampleRate: 48000, blockSize });
  try {
    const result = await host.process({
      frames: 24000,
      events: [67, 60, 64].map((note) =>
        midiInput({
          message: { type: 'noteOn', channel: 1, note, velocity: 100 },
          sampleOffset: 17,
        }),
      ),
    });
    assert.deepEqual(
      result.outputs,
      [],
      'MIDI effect must have no audio outputs',
    );
    assert.deepEqual(result.warnings, []);
    const events = result.events
      .map(midiOutput)
      .filter((event) => event !== null);
    const onsets = events.filter((event) => event.message.type === 'noteOn');
    assert.deepEqual(
      onsets.map((event) => [event.sampleOffset, event.message.note]),
      [
        [17, 60],
        [6017, 64],
        [12017, 67],
        [18017, 60],
      ],
    );
    const release = await host.process({
      frames: 512,
      events: [60, 64, 67].map((note) =>
        midiInput({
          message: { type: 'noteOff', channel: 1, note, velocity: 0 },
          sampleOffset: 37,
        }),
      ),
    });
    const offs = release.events
      .map(midiOutput)
      .filter((event) => event?.message.type === 'noteOff');
    assert.ok(
      offs.some(
        (event) => event.sampleOffset === 37 && event.message.note === 64,
      ),
    );
    await host.reset();
    const reset = await host.process({ frames: 12000 });
    assert.ok(
      reset.events.every((event) => event.type !== 'noteOn'),
      'Reset must not restart held notes',
    );
    console.log(
      `MIDI-only VST3: exact chord output, release and reset at block size ${blockSize}`,
    );
  } finally {
    await host.close();
  }
}
