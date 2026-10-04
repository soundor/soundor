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
import * as fs from 'soundor:fs';
import { plugin, snapshot, subscribe } from 'soundor:host';
import { loadPreset, measure, type Level, type Preset } from 'soundor:native';
import { storage } from 'soundor:storage';

import logo from './logo.png';
const asset: string = logo;
// @ts-expect-error assets are opaque ids, not arbitrary strings
const forgedAsset: typeof logo = 'x.png';

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

const id: 'com.example.dts' = plugin.id;
const bpm: number | undefined = snapshot().transport?.bpm;
const stopHost: () => void = subscribe((s) => void s.sampleRate);
const volume: Promise<number | undefined> = storage.get<number>('volume');
const presets: Promise<string> = fs.readText('presets/a.json');
void fs.writeBytes('raw.bin', new Uint8Array(2));

// @ts-expect-error storage keys are strings
void storage.get(1);
// @ts-expect-error fs paths are strings
void fs.readText(42);

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

// The Web subset Soundor provides is typed…
const controller = new AbortController();
const response: Promise<Response> = fetch(new URL('https://a.test/x'), { signal: controller.signal });
const bytes: Uint8Array = new TextEncoder().encode('x');
const timer: number = setTimeout(() => console.info(performance.now(), crypto.randomUUID()), 1, 'arg');
const clone: { a: number } = structuredClone({ a: 1 });
self.queueMicrotask(() => reportError(new DOMException('x', 'AbortError')));

// …and nothing else from browsers.
// @ts-expect-error there is no window
void window;
// @ts-expect-error there is no document
void document;
// @ts-expect-error there is no localStorage
void localStorage;

export { asset, forgedAsset, bpm, bypassed, bytes, clone, response, timer, forged, id, lowCut, min, preset, presets, rms, stopHost, unit, values, volume };
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
