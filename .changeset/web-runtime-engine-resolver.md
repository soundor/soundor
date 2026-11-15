---
'@soundor/web-runtime': minor
---

The engine's WebAssembly comes from the installed `@soundor/engine`'s prebuilt release (`engine({ target: 'web' })`), downloaded once into the Soundor cache and verified when `soundor dev` or `soundor build` first needs it: a web plugin needs no Emscripten, CMake or C++ compiler. The page still loads it from the application's own assets. `SOUNDOR_ENGINE_WASM` still names a module to use instead, now checked to be the engine's and to speak the installed version's protocol.
