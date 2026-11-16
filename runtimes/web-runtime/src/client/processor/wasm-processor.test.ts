// The Rust processor compiled to WebAssembly, as the Web runtime runs it: a
// real module (fixture/, the SDK's fixture contract) built with Cargo for
// wasm32-unknown-unknown, driven by WasmProcessor, then by the worklet's own
// source in an AudioWorkletGlobalScope's likeness.
import { runInNewContext } from 'node:vm';

import {
  WASM_STATUS,
  WasmProcessor,
  type WasmStream,
} from '@soundor/engine/web/processor';
import {
  PROCESSOR_NAME,
  workletSource,
  type WorkletOptions,
} from '@soundor/engine/web/processor';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  buildFixture,
  streams as fixtureStreams,
  contract,
  fixtureState,
  parameters,
} from './fixture/build';

const streams: WasmStream[] = [...fixtureStreams];

let wasm: Uint8Array<ArrayBuffer>;
let module: WebAssembly.Module;

beforeAll(() => {
  wasm = buildFixture();
  module = new WebAssembly.Module(wasm);
}, 300_000);

function processor(
  gain: number,
  inputs = [2, 0],
  outputs = [2],
  maxFrames = 128,
): WasmProcessor {
  const created = new WasmProcessor(module, contract, inputs, outputs, streams);
  created.parameters.set(parameters(gain));
  expect(created.prepare(48_000, maxFrames)).toBe(WASM_STATUS.ok);
  return created;
}

const ramp = (frames: number) =>
  Float32Array.from({ length: frames }, (_, i) => i / frames - 0.5);
const times = (samples: Float32Array, gain: number) =>
  Float32Array.from(samples, (sample) => sample * gain);

describe('the Rust processor in WebAssembly', () => {
  it('reuses prepared views for empty, partial and oversized blocks', () => {
    const gain = processor(0.5, [1, 0], [1], 64);
    const input = ramp(257);
    const output = new Float32Array(257);
    const inputs = [input];
    const outputs = [output];
    const f32 = vi.spyOn(globalThis, 'Float32Array');
    const f64 = vi.spyOn(globalThis, 'Float64Array');
    const subarray = vi.spyOn(Float32Array.prototype, 'subarray');
    const statuses: number[] = [];
    try {
      for (const frames of [0, 1, 37, 64, 257])
        statuses.push(gain.process(inputs, outputs, frames));
      expect(f32).not.toHaveBeenCalled();
      expect(f64).not.toHaveBeenCalled();
      expect(subarray).not.toHaveBeenCalled();
    } finally {
      f32.mockRestore();
      f64.mockRestore();
      subarray.mockRestore();
    }
    expect(statuses).toEqual([0, 0, 0, 0, 0]);
    expect(output).toEqual(times(input, 0.5));
    gain.destroy();
  });

  it('reprepares views when the sample rate or block size changes', () => {
    const gain = processor(0.5, [1, 0], [1], 64);
    const input = ramp(257);
    const output = new Float32Array(257);
    for (const rate of [44_100, 96_000]) {
      expect(gain.prepare(rate, 37)).toBe(WASM_STATUS.ok);
      expect(gain.process([input], [output], input.length)).toBe(
        WASM_STATUS.ok,
      );
      expect(output).toEqual(times(input, 0.5));
    }
    gain.destroy();
  });

  it('silences unexpected memory growth instead of allocating callback views', () => {
    const gain = processor(0.5, [1, 0], [1], 64);
    gain.exports.memory.grow(1);
    const output = new Float32Array(37).fill(1);
    expect(gain.process([output], [output], output.length)).toBe(
      WASM_STATUS.failed,
    );
    expect(output).toEqual(new Float32Array(37));
  });

  it('applies the gain to stereo', () => {
    const left = ramp(128);
    const right = ramp(128).reverse();
    const outputs = [new Float32Array(128), new Float32Array(128)];
    expect(processor(0.5).process([left, right], outputs, 128)).toBe(0);
    expect(outputs[0]).toEqual(times(left, 0.5));
    expect(outputs[1]).toEqual(times(right, 0.5));
  });

  it('processes mono', () => {
    const mono = processor(0.25, [1, 0], [1]);
    const input = ramp(64);
    const output = new Float32Array(64);
    expect(mono.process([input], [output], 64)).toBe(0);
    expect(output).toEqual(times(input, 0.25));
  });

  it('takes any number of frames, longer blocks in parts', () => {
    const gain = processor(0.625, [1, 0], [1], 128);
    for (const frames of [0, 1, 127, 128, 129, 1000, 4096]) {
      const input = ramp(frames);
      const output = new Float32Array(frames);
      expect(gain.process([input], [output], frames)).toBe(0);
      expect(output).toEqual(times(input, 0.625));
    }
  });

  it('reads the parameters given before each block', () => {
    const gain = processor(1, [1, 0], [1]);
    const input = new Float32Array(16).fill(1);
    for (const value of [0, 0.5, 1.5, 1]) {
      gain.parameters[0] = value;
      const output = new Float32Array(16);
      gain.process([input], [output], 16);
      expect(output).toEqual(new Float32Array(16).fill(value));
    }
  });

  it('repeats the same processing', () => {
    const gain = processor(0.5);
    const input = ramp(128);
    const first = [new Float32Array(128), new Float32Array(128)];
    gain.process([input, input], first, 128);
    for (let block = 0; block < 50; block++) {
      const again = [new Float32Array(128), new Float32Array(128)];
      gain.process([input, input], again, 128);
      expect(again).toEqual(first);
    }
  });

  it('makes silence of missing inputs', () => {
    const output = [new Float32Array(8).fill(9), new Float32Array(8).fill(9)];
    expect(processor(1).process([undefined, undefined], output, 8)).toBe(0);
    expect(output).toEqual([new Float32Array(8), new Float32Array(8)]);
  });

  it('publishes read-only parameters and streams', () => {
    const gain = processor(0.75);
    gain.transport[0] = 96;
    const one = new Float32Array(32).fill(1);
    gain.process([one, one], [new Float32Array(32), new Float32Array(32)], 32);
    expect(gain.published(1)[0]).toBeCloseTo(20 * Math.log10(0.75), 5);
    const changes = gain.streamChanges();
    // Without a state set, the config's defaults: processingMode 1, pattern
    // [60, 64, 67]; then the wavetable prepare published, maxFrames long.
    expect(changes).toEqual([
      [0, Float32Array.from([0.75, 96, 1, 3, 128])],
      [1, Math.fround(0.75)],
    ]);
    expect(gain.streamChanges()).toEqual([]);
  });

  it('reads the resource prepare published, replaced when prepared again', () => {
    const table = processor(0.5, [1, 0], [1], 64);
    const length = () => {
      table.process([new Float32Array(16)], [new Float32Array(16)], 16);
      const change = table.streamChanges().find(([index]) => index === 0);
      return (change![1] as Float32Array)[4];
    };
    expect(length()).toBe(64);
    expect(table.prepare(48_000, 32)).toBe(WASM_STATUS.ok);
    expect(length()).toBe(32);
    expect(table.prepare(48_000, 128)).toBe(WASM_STATUS.ok);
    expect(length()).toBe(128);
    // Its own: another instance has its own resource.
    const other = processor(0.5, [1, 0], [1], 16);
    other.process([new Float32Array(8)], [new Float32Array(8)], 8);
    expect(
      (other.streamChanges().find(([i]) => i === 0)![1] as Float32Array)[4],
    ).toBe(16);
    expect(length()).toBe(128);
  });

  it('reads the state set before each block, whole', () => {
    const gain = processor(0.5, [1, 0], [1]);
    const history = () => {
      gain.process([new Float32Array(16)], [new Float32Array(16)], 16);
      const change = gain.streamChanges().find(([index]) => index === 0);
      return [...(change![1] as Float32Array)].slice(2, 4);
    };
    expect(history()).toEqual([1, 3]);
    gain.setState(fixtureState(7, 8));
    expect(history()).toEqual([7, 8]);
    // The latest of several, at the next block; kept while nothing changes.
    gain.setState(fixtureState(2, 0));
    gain.setState(fixtureState(4, 5));
    expect(history()).toEqual([4, 5]);
    expect(history()).toEqual([4, 5]);
    // Instances keep their own.
    expect(processor(0.5, [1, 0], [1]).state).toEqual(new Uint8Array(80));
  });

  it('resets, and keeps instances independent', () => {
    const half = processor(0.5, [1, 0], [1]);
    const silent = processor(0, [1, 0], [1]);
    const input = new Float32Array(4).fill(1);
    const a = new Float32Array(4);
    const b = new Float32Array(4);
    half.process([input], [a], 4);
    silent.process([input], [b], 4);
    expect([...a, ...b]).toEqual([0.5, 0.5, 0.5, 0.5, 0, 0, 0, 0]);
    expect(half.reset()).toBe(0);
    half.destroy();
    expect(half.process([input], [a], 4)).toBe(WASM_STATUS.failed);
  });

  it('is silent after a panic, which traps the module', () => {
    const gain = processor(2, [1, 0], [1]);
    const output = new Float32Array(8).fill(1);
    expect(gain.process([new Float32Array(8).fill(1)], [output], 8)).toBe(
      WASM_STATUS.panicked,
    );
    expect(output).toEqual(new Float32Array(8));
    expect(gain.process([new Float32Array(8)], [output], 8)).toBe(
      WASM_STATUS.failed,
    );
  });

  it('is silent before prepare, and refuses an unpreparable configuration', () => {
    const unprepared = new WasmProcessor(
      module,
      contract,
      [1, 0],
      [1],
      streams,
    );
    const output = new Float32Array(4).fill(1);
    expect(unprepared.process([output], [output], 4)).toBe(
      WASM_STATUS.notPrepared,
    );
    expect(output).toEqual(new Float32Array(4));
    expect(unprepared.prepare(48_000, 0)).toBe(WASM_STATUS.invalidArgument);
    expect(unprepared.prepare(-1, 128)).toBe(WASM_STATUS.invalidArgument);
  });

  it('refuses a module built from another config', () => {
    expect(
      () =>
        new WasmProcessor(
          module,
          { ...contract, parameters: 4 },
          [1],
          [1],
          streams,
        ),
    ).toThrow(/another soundor.config/);
    const empty = new WebAssembly.Module(
      Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]),
    );
    expect(() => new WasmProcessor(empty, contract, [1], [1], streams)).toThrow(
      /no Soundor exports/,
    );
  });
});

describe('the worklet', () => {
  /** The worklet's module, evaluated as the AudioWorkletGlobalScope would. */
  function worklet(options: Partial<WorkletOptions> = {}) {
    const posted: unknown[] = [];
    let Registered:
      | (new (init: { processorOptions: WorkletOptions }) => {
          port: { onmessage: ((event: { data: unknown }) => void) | null };
          process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
        })
      | undefined;
    let name = '';
    class AudioWorkletProcessor {
      port = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage: (message: unknown) => posted.push(message),
      };
    }
    runInNewContext(workletSource(), {
      AudioWorkletProcessor,
      WebAssembly,
      sampleRate: 48_000,
      Float32Array,
      Float64Array,
      Uint32Array,
      Math,
      Number,
      Error,
      String,
      JSON,
      registerProcessor: (registered: string, processor: typeof Registered) => {
        name = registered;
        Registered = processor;
      },
    });
    const instance = new Registered!({
      processorOptions: {
        wasm: wasm.slice().buffer,
        contract,
        inputs: [2],
        outputs: [2],
        streams,
        parameters: parameters(0.5),
        maxFrames: 128,
        ...options,
      },
    });
    return { instance, posted, name };
  }

  it('registers the processor and prepares it', () => {
    const { posted, name } = worklet();
    expect(name).toBe(PROCESSOR_NAME);
    expect(posted).toEqual([{ type: 'ready' }]);
  });

  it('processes render quanta through the module, with posted parameters', () => {
    const { instance } = worklet();
    const input = ramp(128);
    const outputs = [[new Float32Array(128), new Float32Array(128)]];
    expect(instance.process([[input, input]], outputs)).toBe(true);
    expect(outputs[0]![0]).toEqual(times(input, 0.5));
    instance.port.onmessage!({
      data: { type: 'parameters', values: parameters(0.25) },
    });
    // A render quantum of another size, and a disconnected input.
    const longer = [[new Float32Array(256), new Float32Array(256)]];
    instance.process([[ramp(256), ramp(256)]], longer);
    expect(longer[0]![1]).toEqual(times(ramp(256), 0.25));
    const silent = [
      [new Float32Array(128).fill(1), new Float32Array(128).fill(1)],
    ];
    instance.process([[]], silent);
    expect(silent[0]![0]).toEqual(new Float32Array(128));
  });

  it('takes the state it is given, and posted, between render quanta', () => {
    const { instance, posted } = worklet({ state: fixtureState(6, 2) });
    const history = () => {
      posted.length = 0;
      // Enough render quanta for the streams to be posted (every 800 frames).
      for (let block = 0; block < 7; block++)
        instance.process(
          [[new Float32Array(128), new Float32Array(128)]],
          [[new Float32Array(128), new Float32Array(128)]],
        );
      const message = posted.find(
        (m) => (m as { type: string }).type === 'streams',
      ) as { changes: [number, Float32Array][] };
      return [...message.changes.find(([index]) => index === 0)![1]].slice(
        2,
        4,
      );
    };
    expect(history()).toEqual([6, 2]);
    instance.port.onmessage!({
      data: { type: 'state', snapshot: fixtureState(3, 1) },
    });
    expect(history()).toEqual([3, 1]);
  });

  it('posts what the processing publishes', () => {
    const { instance, posted } = worklet();
    const one = new Float32Array(128).fill(1);
    // About 60 times a second: every 800 frames at 48 kHz.
    for (let block = 0; block < 7; block++)
      instance.process(
        [[one, one]],
        [[new Float32Array(128), new Float32Array(128)]],
      );
    const types = posted.map((message) => (message as { type: string }).type);
    expect(types.filter((type) => type === 'published')).toHaveLength(7);
    expect(types.filter((type) => type === 'streams')).toHaveLength(1);
  });

  it('reports a module it cannot run, and stays silent', () => {
    const { instance, posted } = worklet({
      contract: { ...contract, streams: 3 },
    });
    expect(posted).toEqual([
      {
        type: 'error',
        message: expect.stringMatching(/another soundor.config/),
      },
    ]);
    const outputs = [
      [new Float32Array(128).fill(1), new Float32Array(128).fill(1)],
    ];
    expect(instance.process([[ramp(128), ramp(128)]], outputs)).toBe(true);
    expect(outputs[0]![0]).toEqual(new Float32Array(128));
  });
});
