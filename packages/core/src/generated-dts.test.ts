/**
 * Compiles the generated `soundor:*` declarations together with a consumer the
 * way a plugin project would, so they are proven usable — not just stable.
 */

import { execFile } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { generateSoundorFiles, type CoreSoundorConfig } from './generate';

const run = promisify(execFile);
const environment = dirname(
  createRequire(import.meta.url).resolve('@soundor/environment/package.json'),
);
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
      type: 'float32',
      id: 'gain',
      label: 'Gain',
      access: 'automatable',
      min: -60,
      max: 6,
      default: 0,
      unit: 'dB',
    },
    {
      type: 'int32',
      id: 'voices',
      label: 'Voices',
      access: 'manual',
      min: 1,
      max: 8,
      default: 4,
    },
    {
      type: 'boolean',
      id: 'bypass',
      label: 'Bypass',
      access: 'automatable',
      default: false,
    },
    {
      type: 'choice',
      id: 'mode',
      label: 'Mode',
      access: 'automatable',
      options: [
        { value: 'mono', label: 'Mono' },
        { value: 'stereo', label: 'Stereo' },
      ],
      default: 'stereo',
    },
    {
      type: 'float32',
      id: 'low-cut',
      label: 'Low cut',
      access: 'readOnly',
      min: 0,
      max: 1,
      default: 0,
    },
  ],
  native: {
    types: {
      Level: { struct: { rms: 'float32', peak: 'float32' } },
      Preset: { struct: { name: 'string', gains: 'float32[]', id: 'uint64' } },
    },
    methods: {
      measure: { args: { samples: 'buffer<float32>' }, returns: 'Level' },
      loadPreset: { args: { path: 'string' }, returns: 'Preset?', async: true },
      setSolo: { args: { slot: 'int32?' } },
    },
  },
};

const consumer = `/// <reference path="./soundor.d.ts" />
import { parameters, type Parameter } from 'soundor:parameters';
import * as fs from 'soundor:fs';
import { plugin, snapshot, subscribe } from 'soundor:host';
import { loadPreset, measure, setSolo, type Level, type Preset } from 'soundor:native';
import { storage } from 'soundor:storage';
import { clipboard, createCanvas, createImage, createText, createTextInput, createView, pressable, root, type PointerEvent as UiPointerEvent, type UiNode } from 'soundor:ui';

import logo from './logo.png';
import vector from './logo.svg';
const asset: string = logo;
const svgAsset: string = vector;
createImage(svgAsset, { width: 200, height: 100 });

const gain: number = parameters.gain.get();
parameters.gain.set(gain - 1);
const unit: 'dB' = parameters.gain.info.unit;
const min: -60 = parameters.gain.info.min;
const bypassed: boolean = parameters.bypass.get();
parameters.mode.set('mono');
const labels: readonly ['Mono', 'Stereo'] = [parameters.mode.info.options[0].label, parameters.mode.info.options[1].label];
const shown: string = parameters.gain.format();
const typed: number | null = parameters.gain.parse('-3 dB');
const position: number = parameters.gain.toNormalized(-3);
const mode: 'mono' | 'stereo' = parameters.mode.fromNormalized(0.5);
const access: 'readOnly' = parameters['low-cut'].info.access;
const lowCut: Parameter<number> = parameters['low-cut'];
const unsubscribe: () => void = parameters.voices.subscribe((voices: number) => {
  void voices;
});
unsubscribe();
parameters.gain.beginGesture();
parameters.gain.endGesture();

const level: Level = measure(new Float32Array(128));
const rms: number = level.rms;
const preset: Promise<Preset | null> = loadPreset('/presets/a.json');
void preset.then((loaded) => loaded && void loaded.gains.map((gain: number) => gain * 2) && void (loaded.id + 1n));
setSolo(null);
setSolo(2);

const id: string = plugin.id;
const bpm: number | undefined = snapshot().transport?.bpm;
const stopHost: () => void = subscribe((s) => void s.sampleRate);
const volume: Promise<number | undefined> = storage.get<number>('volume');
const presets: Promise<string> = fs.readText('presets/a.json');
void fs.writeBytes('raw.bin', new Uint8Array(2));

// @ts-expect-error storage keys are strings
void storage.get(1);
// @ts-expect-error fs paths are strings
void fs.readText(42);

// @ts-expect-error not one of the choice's values
parameters.mode.set('quad');
// @ts-expect-error booleans are not numbers
parameters.bypass.set(1);
// @ts-expect-error undeclared parameter
void parameters.missing;
// @ts-expect-error plain arrays are not Float32Arrays
measure([1, 2]);
// @ts-expect-error nullable arguments are still required
setSolo();
// @ts-expect-error null, never undefined
setSolo(undefined);
// @ts-expect-error a 64-bit integer is a bigint
const notBig: Preset = { name: 'x', gains: [], id: 1 };

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
const list = createView({ height: 120, overflowY: 'scroll' });
list.scrollTo({ top: 40, behavior: 'smooth' });
list.firstChild?.scrollIntoView({ block: 'nearest' });
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

export { asset, width, stopPressing, bpm, bypassed, bytes, clone, response, timer, notBig, id, lowCut, min, preset, presets, rms, stopHost, unit, labels, shown, typed, position, mode, access, volume };
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

  it.each([
    ["Soundor's whole environment", ['es2022'], ['index.d.ts']],
    [
      "the DOM's types",
      ['es2022', 'dom'],
      ['ui.d.ts', 'platform.d.ts', 'assets.d.ts'],
    ],
  ])(
    'give a library the soundor:* modules with %s',
    async (_, lib, declarations) => {
      const library = await mkdtemp(join(tmpdir(), 'soundor-dts-library-'));
      try {
        await cp(environment, library, {
          recursive: true,
          filter: (path) => path === environment || path.endsWith('.d.ts'),
        });
        await writeFile(
          join(library, 'library.ts'),
          `import { readText } from 'soundor:fs';
import { plugin } from 'soundor:host';
import { storage } from 'soundor:storage';
import { createCanvas, createImage, registerFont, root, type Asset } from 'soundor:ui';
import logo from './logo.png';

// The platform's modules are the same for every plugin.
export const presets: Promise<string> = readText(\`\${plugin.id}/presets.json\`);
void storage.set('volume', 1);

// An asset is a string, so another bundler's image imports fit as well.
export function show(source: Asset | string) {
  root.appendChild(createImage(source, { width: 16 }));
}
show(logo);
void registerFont('Brand', 'brand.ttf', { weight: 'bold' });
const context = createCanvas().getContext('2d');
context?.fillRect(0, 0, 1, 1);
`,
        );
        await writeFile(
          join(library, 'tsconfig.json'),
          JSON.stringify({
            compilerOptions: {
              strict: true,
              noEmit: true,
              target: 'es2022',
              module: 'esnext',
              moduleResolution: 'bundler',
              lib,
              types: [],
            },
            files: ['library.ts', ...declarations],
          }),
        );
        await expect(
          run(process.execPath, [tsc, '-p', library, '--pretty', 'false']),
        ).resolves.toMatchObject({ stdout: '' });
      } finally {
        await rm(library, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
