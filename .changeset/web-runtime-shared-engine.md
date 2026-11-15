---
'@soundor/web-runtime': minor
---

The web runtime's `soundor:ui` is now the engine itself (`@soundor/engine/web`): its C++ core, compiled to WebAssembly, holds the node tree, reads styles and lays out with Yoga and its text engine, and its DOM adapter draws with HTML elements and CSS. The runtime's own TypeScript copy of the engine (its Yoga mapping, style checks, text layout and node tree) and its dependency on `@soundor/yoga-wasm` are gone: a page loads one engine module, served by `soundor dev` and emitted as an asset by `soundor build`. Plugins need no change; style errors now read exactly as natively. The module is built from the engine's sources (`pnpm --filter @soundor/engine build:wasm`) and is not yet published: outside the Soundor repository, `SOUNDOR_ENGINE_WASM` names one.
