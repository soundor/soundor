// @soundor/engine/web/processor: a plugin's Rust processor in a browser, the
// Web side of the engine's processor hosting. `WasmProcessor` drives the
// WebAssembly the plugin's native/ crate compiles to (the SDK's
// `soundor_wasm_*` exports, its wasm.rs) in any JavaScript (a Node test, a
// worker); `createProcessorNode` runs it in an AudioWorklet of any
// `BaseAudioContext`. The plugin's module is not part of the engine: the
// runtime passes its bytes. Apart from `@soundor/engine/web` so a page that
// only shows a UI loads none of it.

export {
  WASM_ABI_VERSION,
  WASM_STATUS,
  WasmProcessor,
  type WasmStream,
  type WasmStreamChange,
  type WasmContract,
} from './wasm-processor.ts';
export {
  createProcessorNode,
  type ProcessorNode,
  type ProcessorNodeOptions,
} from './node.ts';
// The worklet module itself and its messages, for a host that registers it
// (or runs it) on its own rather than through createProcessorNode.
export {
  PROCESSOR_NAME,
  workletSource,
  type WorkletCommand,
  type WorkletMessage,
  type WorkletOptions,
} from './worklet.ts';
