# @soundor/engine

The independently versioned C++ UI engine: Hermes, Yoga, Skia, WebGL, accessibility, and the native Soundor modules. JUCE integration lives in `@soundor/juce-runtime`.

- [Guide and reference](https://soundor.dev/docs/contribute/engine-reference)
- [Documentation](https://soundor.dev/docs)
- [Architecture](https://soundor.dev/docs/architecture)

Its platform-independent core (the node tree, Yoga layout, styles and text layout) also compiles to WebAssembly: `@soundor/engine/web` runs it with a DOM adapter, and is the web runtime's `soundor:ui`. The module is not part of this package: it is an archive of the engine's prebuilt release, which `engine({ target: 'web' })` (this package's Node API) downloads, verifies and caches; see [Soundor Engine](https://soundor.dev/docs/engine#the-webassembly-core) and [The engine in the browser](https://soundor.dev/docs/contribute/web-engine).
