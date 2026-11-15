# The engine in WebAssembly

The engine's platform-independent C++ core (`cmake/SoundorCoreSources.cmake`:
the node tree, style reading, Yoga layout, text layout), compiled to WebAssembly
with Emscripten as `soundor-core.wasm`. With the DOM adapter in `web/src/`, it
is `@soundor/engine/web`, which is the web runtime's `soundor:ui`.

The architecture, the command protocol, text measurement, how the module is
found and loaded, the tests, the measurements and the limitations are in
[The engine in the browser](../../../apps/website/content/docs/contribute/web-engine.md)
(soundor.dev/docs/contribute/web-engine).

- `Engine.cpp`: plain C++, a `ui::Surface` driven by batched commands,
  answering with what changed (frames, text lines, scroll extents, errors).
  `tests/core/WasmEngineTests.cpp` compiles it natively, from the core's
  sources and Yoga alone.
- `Exports.cpp`: what is specific to WebAssembly: the C exports, and a
  `TextEngine` that measures through two imports (module `soundor`).
- `CMakeLists.txt`: a standalone module (`-sSTANDALONE_WASM`, no Emscripten
  JavaScript, no pthreads, WebAssembly's own exception handling). Without
  Skia, `src/render/NoVectorScene.cpp` stands in for SVG scenes.

## Commands

From `engines/engine`:

```sh
source <emsdk>/emsdk_env.sh   # Emscripten 7.0.0, as CI pins it (.github/actions/emsdk)
pnpm build:wasm               # cmake --workflow --preset wasm → build/wasm/web/soundor-core.wasm
pnpm test:wasm                # the module and the DOM adapter in Node (happy-dom)
pnpm test:browser             # the DOM adapter in Chromium (Playwright)
pnpm fixture                  # the fixture page (Vite), http://localhost:4380/
pnpm bench:wasm               # sizes and timings in headless Chromium → build/wasm/bench.json
```

`pnpm build` compiles the JavaScript only, and native builds never need
Emscripten. The module is never committed or published.
