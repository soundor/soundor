// Cross-runtime parity: the same lib/ crate run as the VST3 runtime runs it
// (the Debug VST3 in the VST3 host) and as the Web runtime runs it (built
// for wasm32-unknown-unknown, driven by the worklet's WasmProcessor in
// Node), given the same input, parameters and audio state, plays the same.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  describeAudioState,
  writeAudioState,
} from '@soundor/runtime-sdk/client';
import { launchHost, noise } from '@soundor/vitest-e2e';
import { WASM_STATUS, WasmProcessor } from '@soundor/web-runtime/processor';
import { beforeAll, expect, test } from 'vitest';

import manifest from '../../.soundor/generated/runtimes/web/manifest.json' with { type: 'json' };

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** From a normalized value to the plain one the processor reads, compiled by
    `gen` from the same expressions as the plugin's native code. */
const { behaviors } = (await import(
  new URL(
    '../../.soundor/generated/runtimes/web/parameters.js',
    import.meta.url,
  ).href
)) as { behaviors: { toValue(normalized: number): number }[] };

const sampleRate = 48_000;
const blockSize = 512;
const layout = describeAudioState(
  manifest.state as Parameters<typeof describeAudioState>[0],
);

let module: WebAssembly.Module;

beforeAll(() => {
  // As `soundor build web` compiles it, into the same target directory.
  const target = `${ROOT}.soundor/cache/lib/target`;
  const built = spawnSync(
    'cargo',
    [
      'rustc',
      '--manifest-path',
      `${ROOT}lib/Cargo.toml`,
      '--lib',
      '--crate-type',
      'cdylib',
      '--release',
      '--target',
      'wasm32-unknown-unknown',
      '--target-dir',
      target,
    ],
    { encoding: 'utf8' },
  );
  if (built.status !== 0)
    throw new Error(
      `Cargo could not build lib/ for WebAssembly:\n${built.stderr}`,
    );
  module = new WebAssembly.Module(
    readFileSync(`${target}/wasm32-unknown-unknown/release/soundor_e2e.wasm`),
  );
}, 300_000);

const input = [
  noise({ seconds: 0.5, amplitude: 0.5, seed: 1 }),
  noise({ seconds: 0.5, amplitude: 0.5, seed: 2 }),
];

/** Through the VST3, with parameters by title; and their plain values. */
async function throughVst3(settings: Readonly<Record<string, number>>) {
  const host = await launchHost({ sampleRate, blockSize });
  for (const [title, value] of Object.entries(settings))
    await host.parameter(title).set(value);
  const plain: number[] = [];
  for (const [index, parameter] of manifest.parameters.entries()) {
    const { normalized } = await host.parameter(parameter.label).get();
    plain.push(behaviors[index]!.toValue(normalized));
  }
  const { outputs } = await host.process({ inputs: [input] });
  return { plain, output: outputs[0]! };
}

/** Through the WebAssembly module, block by block. */
function throughWasm(
  plain: readonly number[],
  state?: Record<string, unknown>,
) {
  const processor = new WasmProcessor(
    module,
    {
      parameters: manifest.parameters.length,
      published: 0,
      streams: manifest.native.streams.length,
      state: layout.size,
    },
    [2],
    [2],
    manifest.native.streams.map(({ kind, element }) => ({
      kind: kind as 'number' | 'buffer',
      element,
    })),
  );
  processor.parameters.set(plain);
  if (state) {
    const bytes = new Uint8Array(layout.size);
    writeAudioState(layout, state, new DataView(bytes.buffer));
    processor.setState(bytes);
  }
  expect(processor.prepare(sampleRate, blockSize)).toBe(WASM_STATUS.ok);
  const frames = input[0]!.length;
  const output = [new Float32Array(frames), new Float32Array(frames)];
  for (let offset = 0; offset < frames; offset += blockSize) {
    const end = Math.min(frames, offset + blockSize);
    expect(
      processor.process(
        input.map((channel) => channel.subarray(offset, end)),
        output.map((channel) => channel.subarray(offset, end)),
        end - offset,
      ),
    ).toBe(WASM_STATUS.ok);
  }
  processor.destroy();
  return output;
}

const cases: { name: string; settings: Record<string, number> }[] = [
  { name: 'the defaults', settings: {} },
  { name: 'Gain and Invert', settings: { Gain: 0.3, Mode: 1 } },
  { name: 'Bypass', settings: { Gain: 0, Bypass: 1 } },
];

test.each(cases)(
  'the VST3 and the WebAssembly build play the same: $name',
  async ({ settings }) => {
    const vst3 = await throughVst3(settings);
    const wasm = throughWasm(vst3.plain, { level: 1, note: '' });

    for (const channel of [0, 1])
      expect(wasm[channel]).toBeCloseToAudio(vst3.output[channel]!, {
        tolerance: 1e-7,
      });
  },
);

// Natively, the preset that sets it is session.test.ts's.
test('the WebAssembly build reads the audio state', () => {
  // Gain 0.5, inverted, at level 0.5.
  const plain = [0.25, 1, 0].map((normalized, index) =>
    behaviors[index]!.toValue(normalized),
  );

  const output = throughWasm(plain, { level: 0.5, note: '' });

  expect(output[0]).toBeCloseToAudio(
    input[0]!.map((sample) => -0.25 * sample),
    {
      tolerance: 1e-7,
    },
  );
});
