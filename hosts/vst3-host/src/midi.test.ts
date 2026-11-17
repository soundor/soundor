import { expect, it } from 'vitest';

import { midiInput, midiOutput } from './midi.ts';
it('converts all supported channel messages and preserves Note On zero', () => {
  expect(
    midiInput({
      message: { type: 'noteOn', channel: 16, note: 127, velocity: 0 },
      sampleOffset: 17,
    }),
  ).toEqual({
    type: 'noteOn',
    channel: 15,
    bus: 0,
    time: 17,
    pitch: 127,
    velocity: 0,
  });
  expect(
    midiInput({
      message: { type: 'pitchBend', channel: 1, value: 16383 },
      sampleOffset: 0,
    }),
  ).toMatchObject({ type: 'pitchBend', value: 1 });
  expect(
    midiInput({
      message: { type: 'pitchBend', channel: 1, value: 0 },
      sampleOffset: 0,
    }),
  ).toMatchObject({ value: -1 });
  expect(
    midiInput({
      message: { type: 'programChange', channel: 1, program: 127 },
      sampleOffset: 0,
    }),
  ).toMatchObject({ type: 'programChange', program: 127 });
  expect(
    midiInput({
      message: {
        type: 'polyphonicAftertouch',
        channel: 1,
        note: 60,
        pressure: 127,
      },
      sampleOffset: 0,
    }),
  ).toMatchObject({ type: 'polyPressure', pressure: 1 });
  expect(
    midiInput({
      message: {
        type: 'controlChange',
        channel: 1,
        controller: 127,
        value: 127,
      },
      sampleOffset: 0,
    }),
  ).toMatchObject({ type: 'controlChange', value: 1 });
  expect(
    midiInput({
      message: { type: 'channelPressure', channel: 1, pressure: 0 },
      sampleOffset: 0,
    }),
  ).toMatchObject({ type: 'channelPressure', value: 0 });
  expect(
    midiInput({
      message: { type: 'noteOff', channel: 1, note: 60, velocity: 127 },
      sampleOffset: 0,
    }),
  ).toMatchObject({ type: 'noteOff', velocity: 1 });
});
it('decodes notes, pressure and VST3 legacy controller output', () => {
  expect(
    midiOutput({
      type: 'noteOn',
      channel: 0,
      pitch: 60,
      velocity: 0,
      time: 23,
      bus: 0,
      noteId: -1,
    }),
  ).toEqual({
    message: { type: 'noteOn', channel: 1, note: 60, velocity: 0 },
    sampleOffset: 23,
    source: 'host',
  });
  for (const [controller, type] of [
    [7, 'controlChange'],
    [128, 'channelPressure'],
    [129, 'pitchBend'],
    [130, 'programChange'],
  ] as const) {
    expect(
      midiOutput({
        type: 'midiCC',
        channel: 15,
        controller,
        value: 127,
        value2: 127,
        time: 0,
        bus: 0,
      })?.message.type,
    ).toBe(type);
  }
  expect(
    midiOutput({ type: 'other', time: 0, bus: 0, vstType: 42 }),
  ).toBeNull();
});
it('rejects invalid values and offsets', () => {
  expect(() =>
    midiInput({
      message: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
      sampleOffset: 0,
    }),
  ).toThrow('MIDI:');
  expect(() =>
    midiInput({
      message: { type: 'noteOn', channel: 1, note: 60, velocity: 100 },
      sampleOffset: -1,
    }),
  ).toThrow('MIDI: invalid sample offset');
});
