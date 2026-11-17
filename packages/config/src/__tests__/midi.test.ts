import { expect, it } from 'vitest';

import { resolveConfig } from '../index';

const resolve = (midi?: unknown) =>
  resolveConfig({
    plugin: { id: 'com.acme.midi', name: 'MIDI' },
    runtimes: [],
    ...(midi === undefined ? {} : { midi }),
  });

it('defaults both independent capabilities to false', () => {
  expect(resolve().midi).toEqual({ input: false, output: false });
  expect(resolve({ input: true }).midi).toEqual({ input: true, output: false });
  expect(resolve({ output: true }).midi).toEqual({
    input: false,
    output: true,
  });
});
it.each([{ input: 1 }, { output: 'true' }, { buses: [] }, null])(
  'rejects invalid MIDI config %j',
  (midi) => {
    expect(() => resolve(midi)).toThrow('Invalid Soundor config');
  },
);

it('gives MIDI effects an audio-free default layout while retaining audio validation for effects', () => {
  const config = resolveConfig({
    plugin: { id: 'com.acme.arp', name: 'Arp', kind: 'midiEffect' },
    runtimes: [],
    midi: { output: true },
  });
  expect(config.audio).toEqual({
    buses: {},
    layouts: { midi: {} },
    defaultLayout: 'midi',
  });
  expect(config.midi).toEqual({ input: false, output: true });
});
