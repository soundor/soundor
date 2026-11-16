---
'soundor': minor
'@soundor/web-runtime': minor
---

**Breaking:** the Web runtime runs the plugin's Rust processor, `lib/`, the one the JUCE plugin runs: `soundor dev web` and `soundor build web` compile it with Cargo for `wasm32-unknown-unknown`, the bundle carries the module, and the host runs it in an AudioWorklet (no wasm-bindgen, no `SharedArrayBuffer`, render quanta of any length), with the parameters and the transport posted to it and what it publishes (read-only parameters, native streams) brought back to the UI. `startSoundorWebHost()` no longer takes `audio`, and `WebAudioSetup` is gone: delete `runtimes/web/src/audio.ts` and move its processing into `lib/`. `init` no longer scaffolds `audio.ts`, and `soundor doctor` checks for the `wasm32-unknown-unknown` target. The Rust SDK's `soundor::export!` also defines the WebAssembly exports the worklet calls (`soundor_wasm_*`), on that target only. `createProcessorNode()` runs a processor module in any `BaseAudioContext`.
