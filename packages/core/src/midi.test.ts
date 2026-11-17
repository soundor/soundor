import { expect, it } from 'vitest';

import { decodeMidi, encodeMidi } from './midi';

it('round trips every channel message, channel and boundary value', () => {
  for (let status = 0x80; status < 0xf0; status++) {
    for (const a of [0, 60, 127])
      for (const b of [0, 100, 127]) {
        const bytes = Uint8Array.from(
          status >> 4 === 12 || status >> 4 === 13
            ? [status, a]
            : [status, a, b],
        );
        expect(encodeMidi(decodeMidi(bytes))).toEqual(bytes);
      }
  }
  expect(decodeMidi([0x90, 60, 0])).toEqual({
    type: 'noteOn',
    channel: 1,
    note: 60,
    velocity: 0,
  });
});
it.each([
  [],
  [0xf0, 0, 0],
  [0x90, 128, 0],
  [0x90, -1, 0],
  [0x90, 60],
  [0x90, 60, NaN],
])('rejects invalid bytes %j', (...bytes) => {
  expect(() => decodeMidi(bytes)).toThrow('MIDI:');
});
it.each([0, 17, 1.5, NaN])('rejects invalid channel %s', (channel) => {
  expect(() =>
    encodeMidi({ type: 'noteOn', channel, note: 60, velocity: 100 }),
  ).toThrow('MIDI:');
});
it.each([-1, 128, 0.5, Infinity])('rejects invalid data %s', (velocity) => {
  expect(() =>
    encodeMidi({ type: 'noteOn', channel: 1, note: 60, velocity }),
  ).toThrow('MIDI:');
});
