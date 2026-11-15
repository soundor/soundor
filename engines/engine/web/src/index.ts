// @soundor/engine/web (experimental): Soundor's C++ engine core in
// WebAssembly, and its DOM adapter. The module (soundor-core.wasm) is built
// separately (`pnpm --filter @soundor/engine build:wasm`) and not part of
// this package.
export { Engine, EngineNode, type EngineOptions } from './engine.ts';
export type { Line, NodeType, Rect } from './state.ts';
export type { Length, Style } from './style.ts';
