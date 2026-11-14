import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { resolveConfig } from '@soundor/runtime-sdk';
import { expect, it } from 'vitest';

import { generateJuceSources } from './codegen';
import { resolveJuceOptions } from './options';
const config = resolveConfig({
  plugin: { id: 'dev.soundor.state-test', name: 'State Test' },
  runtimes: [],
  parameters: {
    gain: { type: 'float32', min: 0, max: 1, default: 0.5 },
    bypass: { type: 'boolean', label: 'Bypass', default: false },
    mode: {
      type: 'choice',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
      default: 'a',
    },
  },
  native: {
    types: {
      Band: {
        struct: { frequency: 'float32', gain: 'float64', label: 'string?' },
      },
      Group: { struct: { bands: 'Band[]', index: 'uint64' } },
    },
    // The processor owns them (JuceStateTests.cpp publishes one).
    events: { bandChanged: { band: 'Band', index: 'uint32' } },
    channels: { meter: { type: 'buffer<float32>', maxLength: 4 } },
  },
  state: {
    signedValue: { type: 'int64', default: -9223372036854775808n },
    unsignedValue: { type: 'uint64', default: 18446744073709551615n },
    precise: { type: 'float64', default: Number('0.000012345678901234567') },
    selectedPreset: { type: 'string?', default: null },
    enabled: { type: 'boolean', default: true },
    groups: {
      type: 'Group[]',
      default: [
        {
          bands: [{ frequency: 1000, gain: -3.125, label: null }],
          index: 18446744073709551615n,
        },
      ],
    },
  },
});
it('generates the persistent processor compiled by the JUCE integration tests', () => {
  const files = generateJuceSources(config, {
    nativeDir: '/native',
    options: resolveJuceOptions({}, config.plugin),
  });
  for (const f of files.filter((f) =>
    /Soundor(State|Processor|Parameters|Native)\.(h|cpp)$/.test(f.path),
  )) {
    const path = resolve(
      import.meta.dirname,
      '../native/backend/juce/tests/generated/state',
      f.path,
    );
    if (process.env.UPDATE_GOLDEN === '1') {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, f.contents);
    }
    expect(readFileSync(path, 'utf8')).toBe(f.contents);
  }
});
