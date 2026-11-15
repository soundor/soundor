# The engine in WebAssembly (experimental)

A proof of concept: the engine's platform-independent C++ core compiled to
WebAssembly with Emscripten, driven from JavaScript (`@soundor/engine/web`),
and shown by a DOM adapter as real HTML elements. It shows that a shared core
could replace the web runtime's reimplementation of the engine (its layout
mapping, semantics and so on) with the engine itself. Nothing uses it yet: the
runtimes are unchanged.

## Architecture

```
            shared C++ core (SoundorCoreSources.cmake)
   ui::Surface: node tree, Yoga layout, styles (ui/StyleReader),
   text layout (ui::TextEngine), animations          + Yoga
              │                                 │
   native runtime (unchanged)          WebAssembly engine (wasm/)
   Hermes: UiModule.cpp reads a        Engine.cpp: batched commands in,
   style object through StyleReader    changed frames and text lines out
   Skia: Renderer, SkiaText            Exports.cpp: C exports; a TextEngine
   GPU compositor, platform windows    measuring through two JS imports
                                                │
                                       web/src: Engine (loader, commands),
                                       DomAdapter (elements, CSS),
                                       TextMeasurer (canvas measureText)
```

- **One implementation.** `cmake/SoundorCoreSources.cmake` lists the core's
  sources: `ui/Surface.cpp`, `ui/StyleReader.cpp`, `ui/Text.cpp`,
  `ui/Animation.cpp`, `ui/Color.cpp`, `render/Frame.cpp`. The native runtime
  appends them to its sources; `wasm/CMakeLists.txt` compiles the same files
  with Emscripten. Both link the same Yoga (`SoundorYoga.cmake`, its revision,
  patches and `-ffp-contract=off`).
- **What was extracted.** Only what tied the core to Hermes: soundor:ui's
  style reading moved from `modules/ui/UiModule.cpp` to `ui/StyleReader.cpp`
  behind a `StyleSource` interface. The JSI binding is an adapter over it, so
  native behavior and error messages are unchanged; the WebAssembly engine
  is another adapter. `Surface` itself was not changed.
- **What was excluded.** Hermes, Skia, ANGLE, ada, platform accessibility and
  windows. Surface's one link to Skia is SVG (`render/VectorScene`); without
  Skia, `render/NoVectorScene.cpp` makes setting an SVG scene fail and keeps
  SVG nodes at their default size, as `NoWebGL.cpp` does for WebGL.
- **Emscripten stays in `wasm/`.** `Engine.cpp` is plain C++, which
  `tests/core/WasmEngineTests.cpp` also compiles natively (from the core's
  sources and Yoga alone, with no Hermes or Skia). `Exports.cpp` holds the
  WebAssembly-specific part. The module is standalone (`-sSTANDALONE_WASM`,
  no Emscripten JavaScript): `web/src/engine.ts` instantiates it with its few
  imports. It has no pthreads and uses WebAssembly's own exception handling.

## The boundary

JavaScript never calls the core per operation. `CommandWriter`
(`web/src/protocol.ts`) appends commands to one buffer: `Create`, `Release`,
`Insert`, `Remove`, `Style`, `Text`, `Size`, `Scale`, `Layout`. Each is 32-bit
words; a string is its UTF-8 length, then its bytes padded to a word.
`flush()` copies the buffer into the module's memory and makes one call,
`soundor_engine_apply`. The answer is records of what changed since the last
answer, in a buffer whose address the call returns:

- `Frame`: a node's box relative to its parent's border box (`node.layout`),
  its offset in the parent's padding box (an absolutely positioned element's
  `left`/`top`), and its borders;
- `Text`: a text node's font and lines, each line's UTF-16 offsets and box
  (placed as the native renderer places it, with `textAlign` applied);
- `Error`: a command the engine refused, by index. The rest of the batch
  runs. An invalid style is a `TypeError`, and the node keeps its last valid
  style, in the engine and in the DOM.

Nodes are named by handles that JavaScript allocates (and reuses after a
release), so creating a node needs no call. Mounted, an engine flushes once per
task (a microtask), and when its container resizes. `node.layout` flushes if
anything changed.

## Text measurement

Yoga needs text sizes, and the browser owns fonts. The engine keeps line
breaking: `TextEngine::layout()`, the same greedy word wrap as native. The
browser only measures. `BrowserTextEngine` (`Exports.cpp`) implements
`advance()` and `metrics()` by calling two imports. JavaScript measures with a
canvas's `measureText()` in the CSS font the DOM then draws with
(`cssFont()`). Line breaking measures each candidate line again and again
while Yoga lays out, so every width is cached per font in C++. A relayout at a
width already seen crosses no boundary at all. The DOM adapter then draws each
line the engine made as its own `<span>` (`white-space: pre`). The browser
never wraps text itself, so the engine's layout and what is drawn cannot
disagree on where lines break.

Canvas and DOM agree to about 0.015 px a line once both kern: the canvas's
`fontKerning: 'auto'` skipped the kerning an element applies to `serif` and
`sans-serif` in Chromium on Linux, a 1 px difference in a 20 px line. Both
now ask for `normal`.

## The DOM adapter

`engine.mount(container)` gives every node an element: a `<div>` per view, a
`<span>` per text node, nested as the tree is, and inspectable in developer
tools. Every element is absolutely positioned at the box the engine reported,
and `box-sizing: border-box` with the engine's border widths. The browser runs
no layout of its own over them; CSS only draws (colors, borders, corners,
outline, opacity, clipping, z-index, cursor). Updates change the existing
elements. A `ResizeObserver` on the container sets the engine's size and lays
out before the next paint. `devicePixelRatio` is the engine's scale, so boxes
snap to device pixels as they do natively. `dispose()` destroys the C++ engine
and removes the elements and the observer.

## Commands

From `engines/engine`:

```sh
source <emsdk>/emsdk_env.sh        # Emscripten 7.0.0, as CI pins it; not needed otherwise
pnpm build:wasm                    # cmake --workflow --preset wasm → build/wasm/web/soundor-core.wasm
pnpm test:wasm                     # the module in Node: API, lifecycle, errors, layout corpus parity
pnpm test:browser                  # the DOM adapter in Chromium (Playwright)
pnpm fixture                       # the fixture page (Vite), http://localhost:4380/
pnpm bench:wasm                    # sizes and timings in headless Chromium → build/wasm/bench.json
cmake --workflow --preset dev      # the native engine, and tests/core's native run of Engine.cpp
```

`pnpm build` compiles the JavaScript only. Native builds never need
Emscripten. The module is never committed, published or downloaded: the
fixture and the tests use the one `build:wasm` wrote.

## Measurements

Emscripten 7.0.0, `-O3` (the `wasm` preset's Release), Chromium 158 headless,
Linux x86-64, in this cell (`pnpm bench:wasm`; medians in ms, localhost):

| What                                             |                                    |
| ------------------------------------------------ | ---------------------------------- |
| `soundor-core.wasm`                              | 339 KB, 139 KB gzip, 113 KB brotli |
| … built `-Os` (MinSizeRel)                       | 293 KB, 129 KB gzip, 106 KB brotli |
| `@soundor/engine/web`, minified                  | 17.8 KB, 5.7 KB gzip               |
| Module fetch + compile                           | 2.3                                |
| Engine start from a compiled module              | 0.1                                |
| 1201-node UI: building it in JavaScript          | 2.2                                |
| … first layout (one call, browser text)          | 9.2                                |
| … first layout (one call, approximate text)      | 4.4                                |
| … mount: elements + the browser's style/layout   | 11.3                               |
| … `measureText()` calls in the first layout      | 976 (1.96 µs each)                 |
| Resize: relayout + DOM update                    | 1.5 (no text measured: cached)     |
| 60 style changes: relayout + DOM update          | 0.97                               |
| One text change: relayout + DOM update           | 0.16                               |
| A batch that changes nothing (all nodes scanned) | 0.065                              |

Text measurement costs about 4.8 ms of the first layout's 9.2: 976
measurements at roughly 5 µs each, of which `measureText()` is 2 µs and the
rest is the import call, decoding UTF-8 and the font check. Later layouts
reuse the cache.

## Limitations

- Views and text only. Images, inputs, canvases, SVG, scrolling, events,
  focus, accessibility and animations are in the core but not exposed.
  `boxShadow` and `transform` styles are refused.
- An invalid style is reported when the engine next lays out (`flush()`, a
  node's `layout`, or the next task when mounted), not when it is set.
- Each change report scans every connected node (65 µs for 1201 nodes). Yoga
  knows which nodes have a new layout; the core does not expose it yet.
- The text cache holds up to 4096 widths per font, then starts again. Fonts
  that load after measuring (web fonts) are not measured again.
- A canvas measures fonts as the DOM draws them only if both resolve the same
  face. That held for the generic and system families tried here, once
  kerning was explicit. Other browsers were not tried.
- Every engine is its own module instance and memory (about 1 MB to start),
  which keeps engines independent at a memory cost.
- Not released. CI's `Engine / wasm` job (`.github/workflows/engine.yml`,
  among the engine's suites) builds the module with the pinned Emscripten and
  runs `test:wasm` and `test:browser` whenever `@soundor/engine` is affected;
  the benchmarks are not a check.
