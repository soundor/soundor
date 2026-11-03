// Fixture Synth: MIDI in and out, controllers, transport, tail.
import { afterEach, expect, test } from 'vitest';

import { VOLUME, closeAll, launch } from './fixtures.ts';

afterEach(closeAll);

test('is a single component with event buses and a tail', async () => {
  const host = await launch('Fixture Synth');
  expect(host.info).toMatchObject({
    separateController: false,
    tailSamples: 4800,
  });
  expect(host.info.buses.audioInputs).toEqual([]);
  expect(host.info.buses.eventInputs).toMatchObject([
    { name: 'MIDI In', channels: 16, active: true },
  ]);
  expect(host.info.buses.eventOutputs).toHaveLength(1);
});

test('plays notes at their frames and echoes them', async () => {
  const host = await launch('Fixture Synth', { blockSize: 64 });
  const result = await host.process({
    frames: 200,
    events: [
      { type: 'noteOn', time: 10, pitch: 60, velocity: 0.5 },
      { type: 'noteOn', time: 100, pitch: 64, velocity: 0.25 },
      { type: 'noteOff', time: 150, pitch: 60 },
    ],
  });
  const level = result.outputs[0]![0]!;
  expect([
    level[9],
    level[10],
    level[99],
    level[100],
    level[149],
    level[150],
  ]).toEqual([0, 0.5, 0.5, 0.75, 0.75, 0.25]);
  expect(
    result.events.map((e) => [e.type, e.time, 'pitch' in e ? e.pitch : 0]),
  ).toEqual([
    ['noteOn', 10, 72],
    ['noteOn', 100, 76],
    ['noteOff', 150, 72],
  ]);
  // Held notes carry over to the next call; reset clears them.
  expect((await host.process({ frames: 4 })).outputs[0]![0]![0]).toBe(0.25);
  await host.reset();
  expect((await host.process({ frames: 4 })).outputs[0]![0]![0]).toBe(0);
});

test('maps MIDI controllers through the plugin, and reports the rest', async () => {
  const host = await launch('Fixture Synth');
  const result = await host.process({
    frames: 100,
    events: [
      { type: 'noteOn', pitch: 60, velocity: 1 },
      { type: 'controlChange', time: 50, controller: 7, value: 0.5 },
      { type: 'controlChange', time: 60, controller: 74, value: 0.5 },
    ],
  });
  const level = result.outputs[0]![0]!;
  expect([level[49], level[50]]).toEqual([1, 0.5]);
  expect(result.warnings).toHaveLength(1);
  expect(result.warnings[0]).toMatch(
    /controlChange 74 on channel 0; it was dropped/,
  );
  expect((await host.getParameter(VOLUME)).normalized).toBe(0.5);
});

test('runs the transport across calls', async () => {
  const host = await launch('Fixture Synth', {
    sampleRate: 48000,
    blockSize: 256,
  });
  const stopped = await host.process({ frames: 8 });
  expect(stopped.outputs[0]![1]![0]).toBe(-1);
  expect(stopped.transport).toMatchObject({
    playing: false,
    samplePosition: 0,
  });

  // 120 BPM at 48 kHz: a quarter note every 24000 frames.
  const playing = await host.process({
    frames: 1000,
    transport: { playing: true, tempo: 120, musicalPosition: 4 },
  });
  const position = playing.outputs[0]![1]!;
  expect(position[0]).toBeCloseTo(4, 6);
  expect(position[999]).toBeCloseTo(4 + 999 / 24000, 5);
  expect(playing.transport).toMatchObject({
    playing: true,
    tempo: 120,
    samplePosition: 96000 + 1000,
    timeSignature: { numerator: 4, denominator: 4 },
  });
  const next = await host.process({ frames: 1 });
  expect(next.outputs[0]![1]![0]).toBeCloseTo(4 + 1000 / 24000, 5);
});
