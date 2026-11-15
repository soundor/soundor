/**
 * `@soundor/web-runtime/processor`: the plugin's processor module outside the
 * Web host. `WasmProcessor` runs the WebAssembly that `soundor build web`
 * compiles from `native/` in any JavaScript (a Node test, a worker);
 * `createProcessorNode` runs it in any `BaseAudioContext`, as the host does.
 */

export {
  WASM_ABI_VERSION,
  WASM_STATUS,
  WasmProcessor,
  type WasmChannel,
  type WasmChannelChange,
  type WasmContract,
} from './wasm-processor';
export {
  createProcessorNode,
  type ProcessorNode,
  type ProcessorNodeOptions,
} from './node';
