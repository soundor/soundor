---
'@soundor/engine': minor
---

Experimental: the engine's platform-independent core (its node tree, Yoga layout, styles and text layout) compiles to WebAssembly with Emscripten (`cmake --workflow --preset wasm`, `pnpm build:wasm`), from the same sources as the native runtime, without Hermes or Skia. `@soundor/engine/web` loads the module (`Engine.create({ wasmUrl })`), drives it with batched commands, and shows its tree as HTML elements placed where the engine laid them out (`engine.mount(container)`), with text measured by the browser. The module is not part of the package. soundor:ui's style reading is now shared by the native binding and the WebAssembly engine (`ui/StyleReader`), with unchanged behavior.
