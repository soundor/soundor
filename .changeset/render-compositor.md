---
'@soundor/juce-runtime': minor
---

Render frames through an explicit compositor. The native runtime now plans the
view as layers (`RuntimeHost::frame()`), tracks which device pixels changed and
rasterizes only those, and a backend-owned `render::Compositor` presents the
result; the generated JUCE editor composites on the CPU into an image and
repaints only the damaged parts. Nothing changes visually.
