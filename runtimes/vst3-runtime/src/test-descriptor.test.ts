import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveConfig } from '@soundor/config';
import { compileJsFunction } from '@soundor/runtime-sdk/expression/js';
import { expect, it } from 'vitest';

import { descriptorJson, describePlugin } from './descriptor';
import { resolveVst3Options } from './options';

// The descriptor the adapter's native tests parse (native/tests/AdapterTests.cpp):
// what descriptor.ts writes, so those tests check the contract between them.
const config = resolveConfig({
  runtimes: [],
  plugin: { id: 'dev.soundor.test.native', name: 'Test' },
  midi: { input: true },
  parameters: {
    gain: {
      type: 'float32',
      label: 'Gain',
      min: 0,
      max: 2,
      default: 1,
      unit: 'x',
    },
    on: { type: 'boolean', label: 'On', default: true },
  },
  native: {
    types: {
      Shape: { enum: ['sine', 'saw'] },
      Band: { struct: { gain: 'float32', shape: 'Shape' } },
    },
  },
  state: {
    label: { type: 'string', default: 'Init' },
    level: { type: 'float32', default: 0.25, audio: true },
    seed: { type: 'uint64', default: 3n },
    band: { type: 'Band', default: { gain: 1, shape: 'sine' } },
    steps: { type: 'int32[]', default: [1], audio: true, maxLength: 4 },
  },
  presets: [{ id: 'up', name: 'Up', parameters: { gain: 2 } }],
});
const options = resolveVst3Options({
  classIds: {
    processor: '0102030405060708090A0B0C0D0E0F10',
    controller: '1112131415161718191A1B1C1D1E1FAB',
  },
});
const golden = fileURLToPath(
  new URL('../native/tests/generated/descriptor.json', import.meta.url),
);

it('is what descriptor.ts writes (UPDATE_GOLDEN=1 writes it)', () => {
  const expected = descriptorJson(config, options);
  if (process.env['UPDATE_GOLDEN'] === '1') {
    mkdirSync(dirname(golden), { recursive: true });
    writeFileSync(golden, expected);
  }
  expect(existsSync(golden) ? readFileSync(golden, 'utf8') : '').toBe(expected);
});

it('formats gain as the native tests expect', () => {
  const gain = describePlugin(config, options).parameters[0]!;
  const format = compileJsFunction(gain.semantics.format, {
    value: 'float32',
  }) as (value: number) => string;
  expect(format(1.25)).toBe('1.25 x');
});
