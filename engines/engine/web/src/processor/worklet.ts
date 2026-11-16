/**
 * The AudioWorklet that runs the plugin's Rust processor: `WasmProcessor`
 * on the audio rendering thread, as the module `workletSource()` writes
 * (a Blob URL needs no file, wherever the host is served from, in an iframe
 * too). It allocates nothing per block but what a message posts: values
 * from the main thread arrive as messages, and what the processing publishes
 * leaves as messages, the streams at most about 60 times a second.
 */

import {
  WasmProcessor,
  type WasmStream,
  type WasmContract,
} from './wasm-processor.ts';

/** The registered processor's name. */
export const PROCESSOR_NAME = 'soundor-processor';

/** What the main thread passes the worklet's processor (`processorOptions`). */
export interface WorkletOptions {
  /** The module's bytes: compiled here, on the rendering thread. */
  readonly wasm: ArrayBuffer;
  readonly contract: WasmContract;
  readonly inputs: readonly number[];
  readonly outputs: readonly number[];
  readonly streams: readonly WasmStream[];
  readonly parameters: readonly number[];
  /** The most frames a block holds; longer render quanta go in parts. */
  readonly maxFrames: number;
}

/** What the worklet posts. */
export type WorkletMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'error'; readonly message: string }
  | { readonly type: 'published'; readonly values: Float64Array }
  | {
      readonly type: 'streams';
      readonly changes: readonly (readonly [number, unknown])[];
    };

/** What the main thread posts. */
export type WorkletCommand =
  | { readonly type: 'parameters'; readonly values: readonly number[] }
  | { readonly type: 'transport'; readonly values: readonly number[] }
  | { readonly type: 'reset' };

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}
declare function registerProcessor(
  name: string,
  processor: new (options: { processorOptions: WorkletOptions }) => unknown,
): void;

// Self-contained as WasmProcessor is: it is run from its own source.
function workletMain(Processor: typeof WasmProcessor, name: string): void {
  class SoundorProcessor extends AudioWorkletProcessor {
    declare processor: WasmProcessor | undefined;
    declare published: number;
    declare reported: boolean;
    declare sinceStreams: number;
    declare streamEvery: number;
    declare ins: (Float32Array | undefined)[];
    declare outs: (Float32Array | undefined)[];

    constructor(options: { processorOptions: WorkletOptions }) {
      super();
      const settings = options.processorOptions;
      this.published = settings.contract.published;
      this.reported = false;
      this.sinceStreams = 0;
      this.streamEvery = Math.max(128, Math.round(sampleRate / 60));
      this.ins = new Array(
        settings.inputs.reduce((sum, count) => sum + count, 0),
      );
      this.outs = new Array(
        settings.outputs.reduce((sum, count) => sum + count, 0),
      );
      try {
        const processor = new Processor(
          new WebAssembly.Module(settings.wasm),
          settings.contract,
          settings.inputs,
          settings.outputs,
          settings.streams,
        );
        processor.parameters.set(settings.parameters);
        const status = processor.prepare(sampleRate, settings.maxFrames);
        if (status !== 0)
          throw new Error(
            `The audio processor could not be prepared (status ${status})`,
          );
        this.processor = processor;
        this.port.postMessage({ type: 'ready' });
      } catch (error) {
        this.processor = undefined;
        this.port.postMessage({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      this.port.onmessage = (event: MessageEvent<WorkletCommand>) => {
        const processor = this.processor;
        const command = event.data;
        if (processor === undefined) return;
        if (command.type === 'parameters')
          processor.parameters.set(command.values);
        else if (command.type === 'transport')
          processor.transport.set(command.values);
        else if (command.type === 'reset') processor.reset();
      };
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
      const processor = this.processor;
      const frames = outputs[0]?.[0]?.length ?? 128;
      if (processor === undefined) {
        for (const bus of outputs) for (const channel of bus) channel.fill(0);
        return true;
      }
      let inputIndex = 0;
      let outputIndex = 0;
      for (let bus = 0; bus < processor.inputs.length; bus++)
        for (let channel = 0; channel < processor.inputs[bus]!; channel++)
          // A disconnected input has no channels: silence.
          this.ins[inputIndex++] = inputs[bus]?.[channel];
      for (let bus = 0; bus < processor.outputs.length; bus++)
        for (let channel = 0; channel < processor.outputs[bus]!; channel++) {
          const output = outputs[bus]?.[channel];
          this.outs[outputIndex++] = output;
        }
      const status = processor.process(this.ins, this.outs, frames);
      if (status !== 0 && !this.reported) {
        this.reported = true;
        this.port.postMessage({
          type: 'error',
          message:
            status === 4
              ? 'The audio processor panicked; it is silent until the audio restarts'
              : `The audio processor failed (status ${status}); it is silent`,
        });
      }
      if (this.published > 0) {
        const values = processor.published(this.published);
        if (values.some((value) => !Number.isNaN(value)))
          this.port.postMessage({ type: 'published', values });
      }
      this.sinceStreams += frames;
      if (
        processor.streams.length > 0 &&
        this.sinceStreams >= this.streamEvery
      ) {
        this.sinceStreams = 0;
        const changes = processor.streamChanges();
        if (changes.length > 0)
          this.port.postMessage({ type: 'streams', changes });
      }
      return true;
    }
  }
  registerProcessor(name, SoundorProcessor);
}

/** The worklet module's source. */
export function workletSource(): string {
  // The class as an expression: whatever name a bundler gave it.
  return `(${workletMain.toString()})((${WasmProcessor.toString()}), ${JSON.stringify(PROCESSOR_NAME)});\n`;
}
