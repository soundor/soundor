---
title: The engine in the browser
description: "@soundor/engine/web: the engine's C++ core compiled to WebAssembly, and the DOM adapter that is the web runtime's soundor:ui."
---

The web runtime's `soundor:ui` is the engine itself. The engine's
platform-independent C++ core (its node tree, style reading, Yoga layout and
text layout) is compiled to WebAssembly, and a DOM adapter in TypeScript shows
the tree as real HTML elements and routes the browser's input to Soundor
events. Both live in `engines/engine` and ship as `@soundor/engine/web`. The
web runtime only starts it, gives it the page's assets, and wires it into the
host page.

```
            shared C++ core (cmake/SoundorCoreSources.cmake)
   ui::Surface: node tree, Yoga layout · ui/StyleReader: styles
   ui::TextEngine: line breaking · animations · colors     + Yoga
              │                                    │
   native runtime                          WebAssembly core (wasm/)
   Hermes: UiModule.cpp reads styles       Engine.cpp: batched commands in,
   through StyleReader; Skia draws;        what changed out (frames, text
   GPU compositor; platform windows        lines, scroll extents, errors)
                                           Exports.cpp: C exports; text
                                           measured through two imports
                                                   │
                                  @soundor/engine/web (web/src/)
                                  core.ts: module, commands, records
                                  ui/: soundor:ui on the DOM (UiNode, Engine,
                                  events, focus, ARIA, scrolling, SVG, canvas,
                                  animations), text.ts: canvas measurement
                                                   │
                                  @soundor/web-runtime: loads the module,
                                  soundor:ui = the page's Engine, assets,
                                  parameters, audio, Vite, the host page
```

## Who owns what

|                                       | Owns                                                                                                                                                                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C++ core (`src/ui`, compiled by both) | The node tree and its rules, reading and checking every style (the same errors natively and on the Web), Yoga layout of both roots (the content and the overlay layer), text line breaking, input and image sizing, a scroll view's content extent                             |
| `wasm/`                               | The command protocol over a `ui::Surface`; what is specific to WebAssembly (exports, a `TextEngine` that asks the browser for widths)                                                                                                                                          |
| `@soundor/engine/web`                 | Loading and instantiating the module; the DOM: one element per node, placed where the engine laid it out; CSS drawing; browser events and hit testing; focus; ARIA; native scrolling with the engine's extents and indicators; SVG and canvas elements; animation presentation |
| `@soundor/web-runtime`                | Starting the engine before the plugin UI loads; `soundor:ui` as the page's engine; asset URLs; parameters, state, the native API, the Rust processor and its AudioWorklet; Vite, `soundor dev`, the host page                                                                  |

What is platform-independent goes in the C++ core; what is the browser's
stays in TypeScript. The core never knows about the DOM. There is one node
tree, in C++: the adapter keeps only what the DOM needs of each node.

### What stays in TypeScript, and why

- **Hit testing, events, focus and scrolling** are the browser's, by Soundor's
  rules (`ui/view.ts`, `ui/events.ts`). The browser already knows what is under
  the pointer, which element has focus and how far a scroll container has
  scrolled. Duplicating that in the module would mean replaying every input
  event into it.
- **Accessibility** is the browser's own, through ARIA (`ui/semantics.ts`,
  with the same rules as `a11y::SurfaceSemantics`).
- **SVG scenes and canvases** are SVG and `<canvas>` elements. The module
  has no Skia: these nodes are image nodes there, sized by the natural size
  the adapter gives it (`Natural`), as a canvas's buffer or an SVG's viewBox
  sizes them natively.
- **Animations** are presented on the elements by the adapter's timeline
  (`ui/animation.ts`), with soundor:ui's API, timing, cancellation and
  completion. They change only presentation (opacity, transforms, colors),
  never layout. Their keyframe colors are checked by the engine's style
  reader (`Check`).

## The boundary

The adapter never calls the core once per operation. `CommandWriter`
(`web/src/protocol.ts`) appends commands to one buffer: `Create`, `Release`,
`Insert`, `Remove`, `Style`, `Text`, `Placeholder`, `Natural`, `Fonts`, `Size`,
`Scale`, `Layout`, `Extent` and `Check`. Each command is a run of 32-bit words.
A string is its UTF-8 length, then its bytes, padded to a whole word. A style's
values keep their shape a few levels deep (arrays and objects, for
`transform` and `boxShadow`) with how `String()` shows each, so the core's
errors read as natively. One call, `soundor_engine_apply`, runs a batch and
answers with records of what changed since the last answer:

- `Frame`: a node's box relative to its parent's border box (`node.layout`),
  its offset in the parent's padding box (the element's `left`/`top`), and its
  borders and padding;
- `Text`: a text or input node's font, line height, where its content starts
  in the view, and its lines (UTF-16 offsets and boxes, `textAlign` applied);
- `Extent`: a scroll view's content size and client size (`contentSize()` and
  `clientSize()`), when they change;
- `Error`: a command the core refused, by index. The rest of the batch runs.

Tree changes, text and sizes wait in the buffer until something needs the
layout: a node's `layout` (or anything measured from it), or the layout the
view runs once per task, before the browser paints. A style is checked at
once: `node.style = …` throws the core's `TypeError` there and then, as
natively, and the node keeps the style it had. That one call also runs
whatever was waiting.

Nodes are named by handles the adapter allocates (1 is the content root, 2
the overlay layer), so creating a node needs no call. A node lives in the core
as long as plugin code can reach it: a `FinalizationRegistry` releases a node
nobody holds, as `ui.js` does natively. Each report scans the connected
nodes and sends only what differs from what it last sent. A node out of the
trees is sent in full when it comes back.

## Text

Line breaking is the engine's (`TextEngine::layout()`, the same greedy word
wrap as native); the browser only measures. `BrowserTextEngine` (`Exports.cpp`)
asks for widths and metrics through two imports. JavaScript measures with a
canvas's `measureText()` in the CSS font the element then draws in
(`cssFont()`, kerning explicit on both). Widths are cached per font in C++, so
Yoga's repeated measurements and a relayout at a known width cross no
boundary. The adapter then shows the engine's lines as they are, each ended by
a line break in a `white-space: pre` element, so where lines break cannot
disagree with what was measured. A text's first baseline is put on the device
pixel the engine's falls on (the browser rounds its font metrics its own way).
When a web font loads, `Fonts` empties the cache and lays text out again.

## Loading the module

`soundor-core.wasm` is built apart from the package's JavaScript and is not
in its npm package.

- **Build it** with `pnpm --filter @soundor/engine build:wasm` (Emscripten
  7.0.0, the version CI pins, from `EMSDK`). Turbo's
  `@soundor/engine#build:wasm` builds it before what needs it (the web
  runtime's tests, every example's `build:web`, the website) and caches it by
  its sources. TypeScript builds, type checks and lint never need Emscripten.
- **Finding it** is `engineWasmPath()` (`runtimes/web-runtime/src/engine-wasm.ts`):
  `SOUNDOR_ENGINE_WASM` if set, otherwise the engine package's own build. It
  fails with how to build it. Nothing else knows where the module is, so a
  resolver of published modules can replace this function alone.
- **In a page**, the runtime's Vite plugin provides `soundor:internal/engine`:
  under `soundor dev`, a URL the dev server answers as `application/wasm`
  with a content hash (cached until it changes, reloaded when it is rebuilt);
  in a build, an asset of its own (`assets/soundor-core-<hash>.wasm`). The
  Web host compiles it (streaming) before anything uses `soundor:ui`, then
  each `Engine` instantiates it synchronously, with its own memory.

A page loads the engine's module, plus the plugin's Rust processor module
when it has audio. It loads no Yoga of its own, no Hermes and no Skia.

## Tests

From `engines/engine`, after `pnpm build:wasm`:

|                                                    |                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:wasm`                                   | The module in Node (happy-dom): loading, independent engines, disposal, batching, styles, text, natural sizes, inputs; the layout corpus through `soundor:ui` (bit for bit the native frames, at three scales); and the DOM adapter's suites (nodes, events, focus, scrolling, `ResizeObserver`, SVG, animations, styles) |
| `pnpm test:browser`                                | Chromium (Playwright): elements where the engine laid them out, text measured by the browser and wrapped by the engine, resizing, pointer input and native scrolling, engines side by side, cleanup, errors                                                                                                               |
| `ctest --test-dir build/dev -R soundor_core_tests` | `wasm/Engine.cpp` compiled natively from the core's sources and Yoga alone: the protocol, both roots, styles with `transform` and `boxShadow`, natural sizes, inputs, extents                                                                                                                                             |

The web runtime's own suites (`pnpm --filter @soundor/web-runtime test`) run
`soundor:ui` and `@soundor/react` on the page's engine. Verify's Workspace job
installs Emscripten (`.github/actions/emsdk`) for them, the examples' web builds
and the website. The Engine group's `wasm` job runs the engine's suites above.

## Measurements

Headless Chromium on Linux x86-64, against the previous runtime (the same
workload through the playground's `soundor:ui`, 1,081 nodes: 120 rows of two
texts and six boxes; medians of alternating runs, in ms):

|                                                   | Before (Yoga per node, from JavaScript) | Shared engine |
| ------------------------------------------------- | --------------------------------------- | ------------- |
| Build the tree in JavaScript                      | 6.4                                     | 9.6           |
| Attach and lay out                                | 7.6                                     | 4.9           |
| Browser style and layout                          | 2.8                                     | 2.8           |
| Initial render                                    | 16.7                                    | 17.3          |
| 60 style changes, layout and DOM                  | 2.5                                     | 2.4           |
| One text change, layout and DOM                   | 0.5                                     | 0.5           |
| Build, attach, lay out, remove (remount)          | 11.3                                    | 13.2          |
| Heap after 30 remounts and a collection           | released                                | released      |
| First plugin nodes on the page (`examples/basic`) | 61                                      | 67            |

Building costs more because each style is checked by the core when it is set
(about 1 µs a call, plus reading it), where layout costs less: one call lays out
the whole tree. A size-optimized module (`-Os`, 12 KB smaller compressed) was
7 to 17% slower, so the module is `-O3`.

Sizes, `examples/basic`'s build:

|                          | Before                                              | Shared engine   |
| ------------------------ | --------------------------------------------------- | --------------- |
| JavaScript (gzip)        | 179 KB (with Yoga's 67 KB module inlined as base64) | 140 KB          |
| WebAssembly (gzip)       | —                                                   | 364 KB · 150 KB |
| Total transferred (gzip) | 179 KB                                              | 290 KB          |

The module holds more than Yoga: the node tree, style reader, text layout,
animation timeline and C++ runtime the native engine also compiles.

## Limitations

- **The module must be built locally** until published engine modules and
  their resolver exist. A project outside this repository needs
  `SOUNDOR_ENGINE_WASM`.
- **Text widths** are the browser's fonts, measured by a canvas. A canvas and
  an element agree to about 0.015 px a line when both resolve the same face.
  The engine's layout is checked in Chromium. Firefox and WebKit are not in CI.
- **Each report scans every connected node** (about 65 µs for 1,200). Yoga
  knows which nodes have a new layout; the core does not expose it yet.
- **The text cache** keeps up to 4,096 widths per font, then starts again.
- **Each engine is its own module instance**, with its own memory (1 MB to
  start), which keeps plugin instances on one page independent.
