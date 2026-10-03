/**
 * Compiles the generated `soundor:*` declarations together with a consumer the
 * way a plugin project would, so they are proven usable — not just stable.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { generateSoundorFiles, type CoreSoundorConfig } from './generate';

const config: CoreSoundorConfig = {
  plugin: { id: 'com.example.dts', name: 'Dts' },
  parameters: [
    {
      type: 'float',
      id: 'gain',
      label: 'Gain',
      min: -60,
      max: 6,
      default: 0,
      unit: 'dB',
    },
    { type: 'int', id: 'voices', label: 'Voices', min: 1, max: 8, default: 4 },
    { type: 'bool', id: 'bypass', label: 'Bypass', default: false },
    {
      type: 'enum',
      id: 'mode',
      label: 'Mode',
      values: ['mono', 'stereo'],
      default: 'stereo',
    },
    {
      type: 'float',
      id: 'low-cut',
      label: 'Low cut',
      min: 0,
      max: 1,
      default: 0,
    },
  ],
  native: {
    types: {
      Level: { struct: { rms: 'number', peak: 'number' } },
      Preset: 'handle',
    },
    methods: {
      measure: { args: { samples: 'Float32Array' }, returns: 'Level' },
      loadPreset: { args: { path: 'string' }, returns: 'Preset', async: true },
    },
  },
};

const consumer = `/// <reference path="./soundor.d.ts" />
import { parameters, type Parameter } from 'soundor:parameters';
import { loadPreset, measure, type Level, type Preset } from 'soundor:native';

const gain: number = parameters.gain.get();
parameters.gain.set(gain - 1);
const unit: 'dB' = parameters.gain.info.unit;
const min: -60 = parameters.gain.info.min;
const bypassed: boolean = parameters.bypass.get();
parameters.mode.set('mono');
const values: readonly ['mono', 'stereo'] = parameters.mode.info.values;
const lowCut: Parameter<number> = parameters['low-cut'];
const unsubscribe: () => void = parameters.voices.subscribe((voices: number) => {
  void voices;
});
unsubscribe();
parameters.gain.beginGesture();
parameters.gain.endGesture();

const level: Level = measure(new Float32Array(128));
const rms: number = level.rms;
const preset: Promise<Preset> = loadPreset('/presets/a.json');

// @ts-expect-error not one of the enum's values
parameters.mode.set('quad');
// @ts-expect-error booleans are not numbers
parameters.bypass.set(1);
// @ts-expect-error undeclared parameter
void parameters.missing;
// @ts-expect-error plain arrays are not Float32Arrays
measure([1, 2]);
// @ts-expect-error handles cannot be forged from plain objects
const forged: Preset = {};

export { bypassed, forged, lowCut, min, preset, rms, unit, values };
`;

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'soundor-dts-'));
  for (const file of generateSoundorFiles(config)) {
    await writeFile(join(dir, file.path), file.contents);
  }
  await writeFile(join(dir, 'consumer.ts'), consumer);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('generated declarations', () => {
  it('type-check against a consumer, rejecting misuse', () => {
    const program = ts.createProgram([join(dir, 'consumer.ts')], {
      strict: true,
      noEmit: true,
      noUnusedLocals: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ['lib.es2022.d.ts'],
      types: [],
    });
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      );
    expect(diagnostics).toEqual([]);
  });
});
