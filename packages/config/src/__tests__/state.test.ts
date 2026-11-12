import { expect, it } from 'vitest';

import {
  defineSoundorConfig,
  resolveConfig,
  checkRuntimeCompatibility,
} from '../index';
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
  ).toThrow();
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

it('refuses state on runtimes that predate runtime API 2', () => {
  const config = resolveConfig({
    ...base,
    state: { enabled: { type: 'boolean', default: true } },
  });
  const old = { id: 'old', apiVersion: 1 } as never;
  const options = { host: { min: 1, current: 2, configVersion: '0.16.0' } };
  expect(() => checkRuntimeCompatibility(old, config, options)).toThrow(
    /does not have/,
  );
  expect(() =>
    checkRuntimeCompatibility(old, resolveConfig(base), options),
  ).not.toThrow();
});
