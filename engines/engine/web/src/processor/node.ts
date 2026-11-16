/**
 * The plugin's Rust processor in a Web Audio graph: an AudioWorkletNode
 * running the worklet of `worklet.ts` on the module's bytes, with the
 * parameters' and the transport's values posted to it as they change.
 */

import type { WasmStream, WasmContract } from './wasm-processor.ts';
import {
  PROCESSOR_NAME,
  workletSource,
  type WorkletCommand,
  type WorkletMessage,
  type WorkletOptions,
} from './worklet.ts';

export interface ProcessorNodeOptions {
  /** The processor's WebAssembly module, as built from native/. */
  readonly wasm: ArrayBuffer | Uint8Array;
  readonly contract: WasmContract;
  /** Each input bus's channels, and each output bus's. */
  readonly inputs: readonly number[];
  readonly outputs: readonly number[];
  readonly streams: readonly WasmStream[];
  /** The parameters' plain values to start with, in the config's order. */
  readonly parameters: readonly number[];
  /** The most frames a block holds; 1024 by default. */
  readonly maxFrames?: number;
  /** Read-only parameters' values the processing published, by slot. */
  readonly onPublished?: (values: Float64Array) => void;
  /** Streams that changed: `[index, value]`. */
  readonly onStreams?: (
    changes: readonly (readonly [number, unknown])[],
  ) => void;
  readonly onError?: (message: string) => void;
}

export interface ProcessorNode {
  readonly node: AudioWorkletNode;
  /** Resolves once the processor is prepared; rejects if it could not be. */
  readonly ready: Promise<void>;
  setParameters(values: readonly number[]): void;
  /** tempo, seconds, beats (NaN unknown), playing (0 or 1), signature (0 unknown). */
  setTransport(values: readonly number[]): void;
  reset(): void;
  dispose(): void;
}

const modules = new WeakMap<BaseAudioContext, Promise<void>>();

/** Adds the worklet's module to `context`, once. */
function addModule(context: BaseAudioContext): Promise<void> {
  let added = modules.get(context);
  if (added === undefined) {
    const url = URL.createObjectURL(
      new Blob([workletSource()], { type: 'text/javascript' }),
    );
    added = context.audioWorklet
      .addModule(url)
      .finally(() => URL.revokeObjectURL(url));
    modules.set(context, added);
  }
  return added;
}

export async function createProcessorNode(
  context: BaseAudioContext,
  options: ProcessorNodeOptions,
): Promise<ProcessorNode> {
  await addModule(context);
  const bytes =
    options.wasm instanceof Uint8Array
      ? options.wasm.slice().buffer
      : options.wasm.slice(0);
  const processorOptions: WorkletOptions = {
    wasm: bytes,
    contract: options.contract,
    inputs: options.inputs,
    outputs: options.outputs,
    streams: options.streams,
    parameters: options.parameters,
    maxFrames: options.maxFrames ?? 1024,
  };
  const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
    numberOfInputs: options.inputs.length,
    numberOfOutputs: options.outputs.length,
    outputChannelCount: [...options.outputs],
    // The main input's channels exactly, as the processor was prepared.
    ...(options.inputs.length > 0
      ? {
          channelCount: Math.max(1, options.inputs[0]!),
          channelCountMode: 'explicit' as const,
        }
      : {}),
    processorOptions,
  });
  let settle: { resolve(): void; reject(error: Error): void };
  const ready = new Promise<void>((resolve, reject) => {
    settle = { resolve, reject };
  });
  const post = (command: WorkletCommand) => node.port.postMessage(command);
  node.port.onmessage = (event: MessageEvent<WorkletMessage>) => {
    const message = event.data;
    if (message.type === 'ready') settle.resolve();
    else if (message.type === 'error') {
      settle.reject(new Error(message.message));
      options.onError?.(message.message);
    } else if (message.type === 'published')
      options.onPublished?.(message.values);
    else if (message.type === 'streams') options.onStreams?.(message.changes);
  };
  // Awaited or not: a failure also reaches onError.
  ready.catch(() => {});
  return {
    node,
    ready,
    setParameters: (values) =>
      post({ type: 'parameters', values: [...values] }),
    setTransport: (values) => post({ type: 'transport', values: [...values] }),
    reset: () => post({ type: 'reset' }),
    dispose: () => {
      node.port.onmessage = null;
      node.port.close();
      node.disconnect();
    },
  };
}
