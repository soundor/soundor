/**
 * The plugin's Rust processor, compiled to WebAssembly, driven through the
 * module's `soundor_wasm_*` exports (the SDK's wasm.rs): the AudioWorklet
 * runs this class, and tests run it in Node on the same module.
 *
 * It is self-contained (no imports, no helpers from outside its source):
 * the worklet is made of its `toString()`. So its code avoids what a bundler
 * would rewrite with a helper of its own, such as class fields.
 */

/** The counts the module must have been built with. */
export interface WasmContract {
  readonly parameters: number;
  readonly published: number;
  readonly streams: number;
  /** The size of the state snapshot (`audio: true` fields); 0 by default. */
  readonly state?: number;
}

/** A native stream as the processor's mailbox holds it. */
export interface WasmStream {
  readonly kind: 'number' | 'buffer';
  readonly element: string;
}

/** One stream's latest value: a number, or a copy of a buffer. */
export type WasmStreamChange = readonly [
  index: number,
  value: number | ArrayLike<number | bigint>,
];

interface Exports {
  readonly memory: WebAssembly.Memory;
  soundor_wasm_contract(index: number): number;
  soundor_wasm_create(): number;
  soundor_wasm_destroy(handle: number): void;
  soundor_wasm_layout(handle: number): number;
  soundor_wasm_parameters(handle: number): number;
  soundor_wasm_transport(handle: number): number;
  soundor_wasm_published(handle: number): number;
  soundor_wasm_state(handle: number): number;
  soundor_wasm_prepare(handle: number, rate: number, frames: number): number;
  soundor_wasm_input(handle: number, index: number): number;
  soundor_wasm_output(handle: number, index: number): number;
  soundor_wasm_process(handle: number, frames: number): number;
  soundor_wasm_reset(handle: number): number;
  soundor_wasm_resource_input(handle: number, length: number): number;
  soundor_wasm_resource_publish(handle: number, index: number): number;
  soundor_wasm_channel_changed(handle: number, index: number): number;
  soundor_wasm_channel_value(handle: number, index: number): number;
  soundor_wasm_channel_buffer(handle: number, index: number): number;
}

/** Statuses, as the SDK's `Status`. */
export const WASM_STATUS = {
  ok: 0,
  invalidArgument: 1,
  notPrepared: 2,
  failed: 3,
  panicked: 4,
  abiMismatch: 5,
} as const;

/** The ABI the module must have been built for. */
export const WASM_ABI_VERSION = 2;

// Statuses are the numbers of WASM_STATUS, written out: the class cannot
// refer to anything outside itself. Its fields are declared, never defined
// as class fields, for the same reason.
export class WasmProcessor {
  declare readonly exports: Exports;
  declare readonly handle: number;
  declare readonly inputs: readonly number[];
  declare readonly outputs: readonly number[];
  declare readonly streams: readonly WasmStream[];
  declare maxFrames: number;
  /** Set once the module trapped (a Rust panic): silent from then on. */
  declare failed: boolean;
  /** The parameters' plain values each block gets, in the config's order. */
  declare readonly parameters: Float64Array;
  /** tempo, seconds, beats (NaN unknown), playing, signature (0 unknown). */
  declare readonly transport: Float64Array;
  /**
   * The state the processing reads, as describeAudioState() lays it out;
   * written into the module before the next block once set (setState()).
   */
  declare readonly state: Uint8Array;
  declare stateChanged: boolean;
  declare stateView: Uint8Array;
  declare inputViews: Float32Array[];
  declare outputViews: Float32Array[];
  declare parameterView: Float64Array;
  declare transportView: Float64Array;
  declare buffer: ArrayBuffer | null;

  /**
   * Instantiates `module` and checks it was built for this ABI and contract;
   * `inputs` and `outputs` are each bus's channels.
   */
  constructor(
    module: WebAssembly.Module,
    contract: WasmContract,
    inputs: readonly number[],
    outputs: readonly number[],
    streams: readonly WasmStream[],
  ) {
    const instance = new WebAssembly.Instance(module, {
      soundor_controller: {
        wake: () => {
          throw new Error('Controllers execute on the main thread');
        },
        service: () => {
          throw new Error('Controller services execute on the main thread');
        },
        read_service_result: () => {
          throw new Error('Controller services execute on the main thread');
        },
      },
    });
    const exports = instance.exports as unknown as Exports;
    if (typeof exports.soundor_wasm_create !== 'function')
      throw new Error(
        "The audio processor's module has no Soundor exports: does native/src/lib.rs call soundor::export!?",
      );
    const built = [0, 1, 2, 3, 4].map((index) =>
      exports.soundor_wasm_contract(index),
    );
    if (built[0] !== 2)
      throw new Error(
        `The audio processor was built for Soundor ABI ${built[0]}, not ${2}: rebuild it`,
      );
    if (
      built[1] !== contract.parameters ||
      built[2] !== contract.published ||
      built[3] !== contract.streams ||
      built[4] !== (contract.state ?? 0)
    )
      throw new Error(
        'The audio processor was built from another soundor.config (its parameters, streams or state differ): rebuild it',
      );
    this.exports = exports;
    this.handle = exports.soundor_wasm_create();
    this.inputs = inputs.slice();
    this.outputs = outputs.slice();
    this.streams = streams.slice();
    this.maxFrames = 0;
    this.failed = false;
    this.parameters = new Float64Array(contract.parameters);
    this.transport = new Float64Array([NaN, NaN, NaN, 0, 0, 0]);
    this.state = new Uint8Array(contract.state ?? 0);
    // The module starts with the config's defaults: nothing to write yet.
    this.stateChanged = false;
    this.inputViews = [];
    this.outputViews = [];
    this.buffer = null;
    this.views();
  }

  /** Allocates the streams in the module's memory, and prepares. */
  prepare(sampleRate: number, maxFrames: number): number {
    const exports = this.exports;
    const layout = new Uint32Array(
      exports.memory.buffer,
      exports.soundor_wasm_layout(this.handle),
      2 + this.inputs.length + this.outputs.length,
    );
    layout[0] = this.inputs.length;
    layout[1] = this.outputs.length;
    layout.set(this.inputs, 2);
    layout.set(this.outputs, 2 + this.inputs.length);
    this.writeValues();
    const status = this.call(() =>
      exports.soundor_wasm_prepare(this.handle, sampleRate, maxFrames),
    );
    if (status === 0) this.maxFrames = maxFrames;
    this.buffer = null;
    this.views();
    return status;
  }

  /**
   * Processes `frames` frames: `inputs` and `outputs` are every channel, in
   * bus order (a missing input is silent). Blocks longer than prepared are
   * processed in parts. Returns the processor's status; a failure leaves the
   * outputs silent.
   */
  process(
    inputs: readonly (Float32Array | undefined)[],
    outputs: readonly (Float32Array | undefined)[],
    frames: number,
  ): number {
    if (this.failed || this.maxFrames === 0) {
      for (const output of outputs) output?.fill(0, 0, frames);
      return this.failed ? 3 : 2;
    }
    for (let start = 0; start < frames || start === 0;) {
      const length = Math.min(this.maxFrames, frames - start);
      // Growing memory detaches prepared views. It indicates an unexpected
      // allocation by the DSP; fail without allocating new views here.
      if (this.exports.memory.buffer !== this.buffer) {
        this.failed = true;
        for (const output of outputs) output?.fill(0, 0, frames);
        return 3;
      }
      for (let index = 0; index < this.inputViews.length; index++) {
        const view = this.inputViews[index]!;
        const input = inputs[index];
        if (input === undefined) view.fill(0, 0, length);
        else
          for (let frame = 0; frame < length; frame++)
            view[frame] = input[start + frame] ?? 0;
      }
      this.writeValues();
      let status: number;
      try {
        status = this.exports.soundor_wasm_process(this.handle, length);
      } catch {
        this.failed = true;
        status = 4;
      }
      if (this.exports.memory.buffer !== this.buffer) {
        this.failed = true;
        status = 3;
      }
      if (status !== 0) {
        for (const output of outputs) output?.fill(0, start, frames);
        return status;
      }
      for (let index = 0; index < outputs.length; index++) {
        const view = this.outputViews[index];
        const output = outputs[index];
        if (view !== undefined && output !== undefined)
          for (let frame = 0; frame < length; frame++)
            output[start + frame] = view[frame]!;
      }
      start += length;
      if (frames === 0) break;
    }
    return 0;
  }

  /** What the last block published for each read-only parameter (NaN for none). */
  published(count: number): Float64Array {
    return new Float64Array(
      this.exports.memory.buffer,
      this.exports.soundor_wasm_published(this.handle),
      count,
    ).slice();
  }

  /** The streams that changed since this was last asked, their values copied. */
  streamChanges(): WasmStreamChange[] {
    const changes: WasmStreamChange[] = [];
    if (this.failed) return changes;
    const exports = this.exports;
    for (let index = 0; index < this.streams.length; index++) {
      const changed = exports.soundor_wasm_channel_changed(this.handle, index);
      if (changed === 0) continue;
      const stream = this.streams[index]!;
      if (stream.kind === 'number') {
        changes.push([
          index,
          exports.soundor_wasm_channel_value(this.handle, index),
        ]);
        continue;
      }
      const Type =
        stream.element === 'float64'
          ? Float64Array
          : stream.element === 'int8'
            ? Int8Array
            : stream.element === 'uint8'
              ? Uint8Array
              : stream.element === 'int16'
                ? Int16Array
                : stream.element === 'uint16'
                  ? Uint16Array
                  : stream.element === 'int32'
                    ? Int32Array
                    : stream.element === 'uint32'
                      ? Uint32Array
                      : stream.element === 'int64'
                        ? BigInt64Array
                        : stream.element === 'uint64'
                          ? BigUint64Array
                          : Float32Array;
      changes.push([
        index,
        new Type(
          exports.memory.buffer,
          exports.soundor_wasm_channel_buffer(this.handle, index),
          changed - 1,
        ).slice(),
      ]);
    }
    return changes;
  }

  /** Between render quanta: allocate and publish a resource, then renew views. */
  publishResource(index: number, bytes: Uint8Array): void {
    if (this.failed) return;
    const pointer = this.exports.soundor_wasm_resource_input(
      this.handle,
      bytes.length,
    );
    new Uint8Array(this.exports.memory.buffer, pointer, bytes.length).set(
      bytes,
    );
    if (this.exports.soundor_wasm_resource_publish(this.handle, index) !== 0)
      throw new Error('Invalid processor resource publication');
    this.views();
  }

  reset(): number {
    if (this.failed) return 3;
    return this.call(() => this.exports.soundor_wasm_reset(this.handle));
  }

  destroy(): void {
    if (!this.failed) this.exports.soundor_wasm_destroy(this.handle);
    this.failed = true;
  }

  /**
   * Sets the state the processing reads from the next block (or prepare):
   * a snapshot of `state.length` bytes. Copied now, written into the module
   * between blocks, so a block never sees one partly written.
   */
  setState(snapshot: Uint8Array): void {
    this.state.set(snapshot.subarray(0, this.state.length));
    this.stateChanged = true;
  }

  /** The parameters, transport and a changed state, into the module's memory. */
  writeValues(): void {
    this.parameterView.set(this.parameters);
    this.transportView.set(this.transport);
    if (this.stateChanged) {
      this.stateView.set(this.state);
      this.stateChanged = false;
    }
  }

  /** The streams' views, made again when memory grew (or after prepare). */
  views(): void {
    const buffer = this.exports.memory.buffer;
    if (buffer === this.buffer) return;
    this.buffer = buffer;
    this.parameterView = new Float64Array(
      buffer,
      this.exports.soundor_wasm_parameters(this.handle),
      this.parameters.length,
    );
    this.transportView = new Float64Array(
      buffer,
      this.exports.soundor_wasm_transport(this.handle),
      6,
    );
    this.stateView = new Uint8Array(
      buffer,
      this.exports.soundor_wasm_state(this.handle),
      this.state.length,
    );
    const view = (pointer: number) =>
      new Float32Array(buffer, pointer, this.maxFrames);
    const total = (counts: readonly number[]) =>
      counts.reduce((sum, count) => sum + count, 0);
    this.inputViews = [];
    for (let index = 0; index < total(this.inputs); index++)
      this.inputViews.push(
        view(this.exports.soundor_wasm_input(this.handle, index)),
      );
    this.outputViews = [];
    for (let index = 0; index < total(this.outputs); index++)
      this.outputViews.push(
        view(this.exports.soundor_wasm_output(this.handle, index)),
      );
  }

  /** A call into the module: a trap (a Rust panic) fails the processor. */
  call(body: () => number): number {
    try {
      return body();
    } catch {
      this.failed = true;
      return 4;
    }
  }
}
