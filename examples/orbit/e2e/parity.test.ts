// Cross-runtime parity: the same lib/ crate, run as the VST3 runtime runs
// it (the Debug VST3, in the VST3 host) and as the Web runtime runs it (built
// for wasm32-unknown-unknown, driven by the worklet's WasmProcessor in
// Node), given the same input, parameters, transport and blocks, gives the
// same audio. Orbit's DSP calls f64 exp, powf, sin and tanh, whose last bit
// may differ between the platform's libm and Rust's WebAssembly one: the
// outputs agree to well below what a 24-bit converter resolves.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { launchHost, noise } from '@soundor/vitest-e2e';
import { WASM_STATUS, WasmProcessor } from '@soundor/web-runtime/processor';
import { beforeAll, expect, test } from 'vitest';

import manifest from '../.soundor/generated/runtimes/web/manifest.json' with { type: 'json' };

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The parameters' mappings, compiled by `gen` from the same expressions as
    the plugin's C++: from a normalized value to the plain one the processor
    reads. */
const { behaviors } = (await import(
  new URL('../.soundor/generated/runtimes/web/parameters.js', import.meta.url)
    .href
)) as {
  behaviors: { toValue(normalized: number): number }[];
};
const sampleRate = 48_000;
const blockSize = 512;
const parameters = manifest.parameters.map((parameter) => parameter.id);

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
    readFileSync(`${target}/wasm32-unknown-unknown/release/orbit.wasm`),
  );
}, 300_000);

/** One stretch of the run: the parameters to set first, by title, normalized. */
interface Stretch {
  readonly set: Readonly<Record<string, number>>;
  readonly seconds: number;
}

/** The run through the VST3, and the plain values of its parameters. */
async function throughVst3(stretches: readonly Stretch[], tempo: number) {
  const host = await launchHost({ sampleRate, blockSize });
  const plain: number[][] = [];
  const outputs: Float32Array[][] = [];
  let seed = 1;
  for (const stretch of stretches) {
    for (const [title, value] of Object.entries(stretch.set))
      await host.parameter(title).set(value);
    const values: number[] = [];
    // From the normalized value, mapped as the plugin maps it, as the web
    // runtime's values are.
    for (const [index, parameter] of manifest.parameters.entries()) {
      const { normalized } = await host.parameter(parameter.label).get();
      values.push(behaviors[index]!.toValue(normalized));
    }
    plain.push(values);
    const input = [
      noise({ seconds: stretch.seconds, amplitude: 0.5, seed: seed++ }),
      noise({ seconds: stretch.seconds, amplitude: 0.5, seed: seed++ }),
    ];
    const result = await host.process({
      inputs: [input],
      transport: { playing: true, tempo },
    });
    outputs.push([...result.outputs[0]!]);
  }
  return { plain, outputs };
}

/** The same run through the WebAssembly module, block by block. */
function throughWasm(
  stretches: readonly Stretch[],
  plain: readonly number[][],
  tempo: number,
) {
  const processor = new WasmProcessor(
    module,
    { parameters: parameters.length, published: 0, streams: 0 },
    [2],
    [2],
    [],
  );
  processor.parameters.set(plain[0]!);
  expect(processor.prepare(sampleRate, blockSize)).toBe(WASM_STATUS.ok);
  // tempo, seconds, beats (unknown), playing, no time signature.
  processor.transport.set([tempo, Number.NaN, Number.NaN, 1, 0, 0]);
  const outputs: Float32Array[][] = [];
  let seed = 1;
  stretches.forEach((stretch, index) => {
    processor.parameters.set(plain[index]!);
    const input = [
      noise({ seconds: stretch.seconds, amplitude: 0.5, seed: seed++ }),
      noise({ seconds: stretch.seconds, amplitude: 0.5, seed: seed++ }),
    ];
    const frames = input[0]!.length;
    const output = [new Float32Array(frames), new Float32Array(frames)];
    for (let offset = 0; offset < frames; offset += blockSize) {
      const end = Math.min(frames, offset + blockSize);
      const status = processor.process(
        input.map((channel) => channel.subarray(offset, end)),
        output.map((channel) => channel.subarray(offset, end)),
        end - offset,
      );
      expect(status).toBe(WASM_STATUS.ok);
    }
    outputs.push(output);
  });
  processor.destroy();
  return outputs;
}

/** The largest difference, and the loudest sample, over every channel. */
function compare(a: Float32Array[][], b: Float32Array[][]) {
  let difference = 0;
  let loudest = 0;
  for (const [stretch, channels] of a.entries())
    for (const [channel, samples] of channels.entries())
      for (const [frame, sample] of samples.entries()) {
        const other = b[stretch]![channel]![frame]!;
        difference = Math.max(difference, Math.abs(sample - other));
        loudest = Math.max(loudest, Math.abs(sample));
      }
  return { difference, loudest };
}

test('the VST3 and the WebAssembly build play the same delay', async () => {
  const tempo = 132;
  // Every path: three voices with drift and repeats, the filter, a change of
  // times mid-run, tempo sync, and Hold.
  const stretches: Stretch[] = [
    {
      set: {
        'Tempo sync': 0,
        Mix: 0.7,
        Motion: 0.8,
        Tone: 0.4,
        Feedback: 0.6,
        Spread: 0.9,
        'Echo 1 level': 1,
        'Echo 2 level': 0.6,
        'Echo 3 level': 0.4,
      },
      seconds: 2,
    },
    { set: { 'Echo 1 time': 0.1, 'Echo 2 time': 0.5, Tone: 0.9 }, seconds: 1 },
    { set: { 'Tempo sync': 1, Feedback: 0.9 }, seconds: 2 },
    { set: { Hold: 1 }, seconds: 1 },
  ];
  const vst3 = await throughVst3(stretches, tempo);
  const wasm = throughWasm(stretches, vst3.plain, tempo);
  const { difference, loudest } = compare(vst3.outputs, wasm);
  console.info(
    `VST3 and WebAssembly differ by at most ${difference} (loudest sample ${loudest})`,
  );
  expect(loudest).toBeGreaterThan(0.1);
  // -120 dBFS.
  expect(difference).toBeLessThan(1e-6);
});

test('bypassed, both fade to the input', async () => {
  const tempo = 120;
  const stretches: Stretch[] = [
    { set: { Feedback: 0.8, Mix: 1 }, seconds: 1 },
    { set: { Bypass: 1 }, seconds: 1 },
  ];
  const vst3 = await throughVst3(stretches, tempo);
  const wasm = throughWasm(stretches, vst3.plain, tempo);
  expect(compare(vst3.outputs, wasm).difference).toBeLessThan(1e-6);
  // Bypass crossfades: half a second on, both are the input.
  const input = [
    noise({ seconds: 1, amplitude: 0.5, seed: 3 }),
    noise({ seconds: 1, amplitude: 0.5, seed: 4 }),
  ];
  for (const output of [vst3.outputs[1]!, wasm[1]!])
    for (const [channel, samples] of output.entries())
      for (let frame = sampleRate / 2; frame < sampleRate; frame++)
        expect(
          Math.abs(samples[frame]! - input[channel]![frame]!),
        ).toBeLessThan(1e-5);
});
