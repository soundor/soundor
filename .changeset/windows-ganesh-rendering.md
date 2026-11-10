---
'@soundor/engine': minor
---

Render retained UI and Canvas 2D with Skia Ganesh through the existing ANGLE device on Windows. Keep layer damage and animation caches on the GPU, share canvas textures with the compositor, and retain CPU rendering when GPU drawing is unavailable. Pixel APIs preserve their existing semantics; a GPU reset clears GPU Canvas 2D contents and resets drawing state.
