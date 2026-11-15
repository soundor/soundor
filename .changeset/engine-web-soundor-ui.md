---
'@soundor/engine': minor
---

`@soundor/engine/web` is the web runtime's `soundor:ui`: its DOM adapter covers every node type (views, text, images, inputs, canvases, SVG) on both roots (the content and the overlay layer), with events, focus, accessibility, scrolling, `ResizeObserver` and animations. `Engine` is the view (`Engine.load()`, `Engine.create()`, `new Engine()`, `createView()` and the like, `mount()`, `dispose()`) and its nodes are `UiNode`s; the experimental `EngineNode` API is replaced. The WebAssembly core reads `transform` and `boxShadow` as natively, sizes images, canvases and SVGs by the natural size the browser gives, measures inputs, reports scroll extents, checks a style when it is set, and measures text again when web fonts load. Reading a style allocates no keys (`ui/StyleReader`), natively too.
