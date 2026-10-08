/**
 * Compiles the generated `soundor:*` declarations together with a consumer the
 * way a plugin project would, so they are proven usable — not just stable.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { generateSoundorFiles, type CoreSoundorConfig } from './generate';

const run = promisify(execFile);
// TypeScript 7 has no compiler API in its main entry point; run the tsc CLI.
const tsc = join(
  dirname(createRequire(import.meta.url).resolve('typescript/package.json')),
  'bin',
  'tsc',
);

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
import { clipboard, createCanvas, createImage, createScrollView, createText, createTextInput, createView, pressable, root, type PointerEvent as UiPointerEvent, type UiNode } from 'soundor:ui';

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

const box: UiNode = root.appendChild(createView({ flexDirection: 'row', width: '50%', padding: 4, flex: 1 }));
const label = createText('hi', { fontSize: 12, fontWeight: 'bold' });
box.insertBefore(label, null);
box.addEventListener('pointerdown', (event) => {
  const x: number = event.offsetX + event.clientY;
  const pressed: UiPointerEvent = event;
  if (event.shiftKey) event.preventDefault();
  void x, void pressed;
});
box.addEventListener('keydown', (event) => void event.key.toUpperCase());
box.addEventListener('wheel', (event) => void event.deltaY);
const width: number = box.layout.width + box.getBoundingClientRect().x;
const card = createView({ backgroundColor: '#202124', borderRadius: 8, borderWidth: 1, borderColor: 'rgb(255 255 255 / 10%)', opacity: 0.9 });
card.appendChild(createImage(logo, { width: 32, height: 32, resizeMode: 'contain' }));
const list = createScrollView({ height: 120 });
list.addEventListener('scroll', () => void list.scrollTop);
list.scrollTo({ top: 10 });
const field = createTextInput({ placeholder: 'Preset', style: { color: 'white' } });
field.addEventListener('input', (event) => void event.data);
field.addEventListener('change', () => void field.value.trim());
field.setSelectionRange(0, field.value.length);
const stopPressing: () => void = pressable(card, { onPress: () => void 0, onStateChange: ({ pressed }) => void pressed });
void clipboard.writeText('x').then(() => clipboard.readText());
const frame: number = requestAnimationFrame((time: number) => void time);
cancelAnimationFrame(frame);
const canvas = createCanvas({ width: 100, height: 50 });
canvas.width = 100 * devicePixelRatio;
const context: CanvasRenderingContext2D | null = canvas.getContext('2d');
if (context) {
  const gradient: CanvasGradient = context.createLinearGradient(0, 0, 1, 0);
  gradient.addColorStop(0, 'red');
  context.fillStyle = gradient;
  context.arc(10, 10, 5, 0, Math.PI * 2);
  context.fill('evenodd');
  const pixels: ImageData = context.getImageData(0, 0, 1, 1);
  context.putImageData(new ImageData(pixels.data, 1), 0, 0);
  const width: number = context.measureText('Soundor').width;
  void width;
  context.drawImage(canvas, 0, 0);
  // @ts-expect-error not a fill rule
  context.fill('even');
}
// @ts-expect-error not a resize mode
createImage(logo, { resizeMode: 'fill' });
// @ts-expect-error images show bundled assets, not arbitrary strings
createImage('logo.png');
// @ts-expect-error not a flex direction
createView({ flexDirection: 'diagonal' });
// @ts-expect-error unknown style property
createView({ widht: 10 });
// @ts-expect-error nodes come from createView()/createText()
void new (root.constructor as typeof UiNode)();

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

export { asset, forgedAsset, width, stopPressing, bpm, bypassed, bytes, clone, response, timer, forged, id, lowCut, min, preset, presets, rms, stopHost, unit, values, volume };
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
  it('type-check against a consumer, rejecting misuse', async () => {
    await writeFile(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          noUnusedLocals: true,
          target: 'es2022',
          module: 'esnext',
          moduleResolution: 'bundler',
          lib: ['es2022'],
          types: [],
        },
        files: ['consumer.ts'],
      }),
    );
    // tsc exits non-zero and prints the diagnostics when the consumer fails.
    await expect(
      run(process.execPath, [tsc, '-p', dir, '--pretty', 'false']),
    ).resolves.toMatchObject({ stdout: '' });
  }, 30_000);
});
