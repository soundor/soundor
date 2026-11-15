/**
 * `@soundor/web-runtime/processor`: the plugin's processor module outside the
 * Web host. The host is the engine's (`@soundor/engine/web/processor`), and
 * this entry is it: `WasmProcessor` runs the WebAssembly that
 * `soundor build web` compiles from `native/` in any JavaScript (a Node test,
 * a worker); `createProcessorNode` runs it in any `BaseAudioContext`, as the
 * host does.
 */

export * from '@soundor/engine/web/processor';
