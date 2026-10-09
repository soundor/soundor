---
'@soundor/juce-runtime': patch
---

WebGL survives losing the GPU. A GPU reset (or a removed GPU) loses canvases' WebGL contexts the way browsers do: calls then do nothing, `getError()` reports `CONTEXT_LOST_WEBGL`, and the canvas gets `webglcontextlost`. Meanwhile the editor goes on compositing on the CPU. `WEBGL_lose_context`'s `loseContext()` really loses the context. The plugin log says which GPU WebGL runs on.
