# soundor-benchmark

Rendering scenarios for Soundor, the same code in the JUCE runtime (Hermes,
Skia, WebGL 2 on ANGLE, the GPU compositor) and in the browser: WebGL through
Three.js (the expensive way and the GPU way) and raw calls, Canvas 2D, UI
updates through React and `soundor:ui`, and a plugin-like mix. `pnpm bench`
measures them headless in the JUCE runtime.

- [Guide and reference](https://soundor.dev/docs/contribute/benchmark)
- [All documentation](https://github.com/soundor/soundor/blob/main/docs/README.md)
- [Architecture](https://soundor.dev/docs/architecture)
