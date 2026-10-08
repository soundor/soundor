---
'@soundor/juce-runtime': minor
---

Composite on the GPU. The new `render::GpuCompositor` (ANGLE) uploads the UI's CPU layers as textures, only where they changed, and presents them into the editor's native view: a sublayer on macOS (Metal), a child window on Windows (Direct3D 11). The generated JUCE editor uses it when there is a hardware GPU, logs which renderer it chose, and composites on the CPU otherwise (always on Linux, and after a lost GPU). `SOUNDOR_RENDERER=cpu` forces the CPU.
