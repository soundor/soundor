import { expect, it } from 'vitest';

import { resolveConfig } from '../index';
const base = {
  plugin: { id: 'test.presets', name: 'Presets' },
  runtimes: [],
  parameters: {
    gain: { type: 'float32', min: 0, max: 1, default: 0.5, step: 0.25 },
    meter: { type: 'float32', min: 0, max: 1, default: 0, access: 'readOnly' },
  },
  state: { title: { type: 'string', default: 'Init' } },
};
it('resolves complete detached snapshots from defaults', () => {
  expect(
    resolveConfig({ ...base, presets: [{ id: 'init', name: ' Init ' }] })
      .presets,
  ).toEqual([
    {
      id: 'init',
      name: 'Init',
      parameters: { gain: 0.5 },
      state: { title: 'Init' },
    },
  ]);
});
it.each([
  [{ id: 'bad', name: 'Bad', parameters: { gain: 0.1 } }],
  [{ id: 'bad', name: 'Bad', parameters: { gain: 2 } }],
  [{ id: 'bad', name: 'Bad', parameters: { missing: 1 } }],
  [{ id: 'bad', name: 'Bad', parameters: { meter: 0.5 } }],
  [{ id: 'bad', name: 'Bad', state: { title: 1 } }],
  [{ id: 'bad', name: 'Bad', state: { missing: true } }],
  [
    { id: 'same', name: 'First' },
    { id: 'same', name: 'Second' },
  ],
  [{ id: 'bad', name: 'Bad', unknown: true }],
])('rejects invalid factory snapshots %#', (...presets) => {
  expect(() => resolveConfig({ ...base, presets })).toThrow(
    'Invalid Soundor config',
  );
});

it('checks factory value types against the declared parameters and state', async () => {
  const { defineSoundorConfig } = await import('../index');
  const config = defineSoundorConfig({
    plugin: { id: 'test.typed-presets', name: 'Typed' },
    runtimes: [],
    parameters: {
      mode: {
        type: 'choice',
        options: [{ value: 'clean', label: 'Clean' }],
        default: 'clean',
      },
      meter: {
        type: 'float32',
        min: 0,
        max: 1,
        default: 0,
        access: 'readOnly',
      },
    },
    state: { title: { type: 'string', default: 'Init' } },
    presets: [
      {
        id: 'bad',
        name: 'Bad',
        parameters: {
          // @ts-expect-error choice values must belong to their declared options
          mode: 'missing',
          // @ts-expect-error processing outputs cannot be preset
          meter: 0.5,
        },
        state: {
          // @ts-expect-error preset state follows the field's declared type
          title: 1,
        },
      },
    ],
  });
  expect(() => resolveConfig(config)).toThrow('Invalid Soundor config');
});
