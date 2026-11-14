import { expect, it } from 'vitest';

import { defineSoundorConfig, resolveConfig } from '../index';
const base = {
  plugin: { id: 'com.example.state', name: 'State' },
  runtimes: [],
};
it('infers defaults from native types and validates them at build time', () => {
  const config = defineSoundorConfig({
    ...base,
    native: {
      types: { Band: { struct: { frequency: 'float32', name: 'string?' } } },
    },
    state: {
      bands: { type: 'Band[]', default: [{ frequency: 1000, name: null }] },
    },
  });
  expect(resolveConfig(config).state).toEqual(config.state);
  expect(() =>
    resolveConfig({ ...base, state: { x: { type: 'uint8', default: 999 } } }),
  ).toThrow(Error);
  defineSoundorConfig({
    ...base,
    state: {
      // @ts-expect-error string default must be a string
      x: { type: 'string', default: 1 },
    },
  });
  defineSoundorConfig({
    ...base,
    state: {
      // @ts-expect-error every field requires a default
      x: { type: 'boolean' },
    },
  });
  defineSoundorConfig({
    ...base,
    native: { types: { Band: { struct: { frequency: 'float32' } } } },
    state: {
      // @ts-expect-error nested struct members are checked
      bands: { type: 'Band[]', default: [{ frequency: 'invalid' }] },
    },
  });
});
