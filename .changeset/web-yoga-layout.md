---
'@soundor/web-runtime': minor
---

The web runtime now lays out with Yoga, the engine's own, compiled to WebAssembly: a plugin UI gets the same boxes in the browser as in a plugin. CSS only draws them. Text wraps as natively, only at spaces and line breaks, text and inputs sit on the same baselines, and scroll views draw the JUCE runtime's thin indicators in place of the browser's scrollbar. Under a strict Content Security Policy the page needs `wasm-unsafe-eval`.
