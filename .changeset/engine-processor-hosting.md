---
'@soundor/engine': minor
'@soundor/juce-runtime': minor
'@soundor/web-runtime': minor
---

The engine hosts the plugin's Rust processor, natively and in the browser; the runtimes keep the audio callback, the AudioContext and the plugin's lifecycle. Neither the Rust SDK nor its ABI changes, and a plugin's code needs no change.

- `@soundor/engine`: `soundor/processor/RustProcessor.h`, the bridge to the processor's C ABI (`RustProcessorAbi.h`, moved from the JUCE runtime), free of JUCE: `processor::RustProcessor` processes an array of channel pointers in place, and reaches the plugin's linked library through `processor::linkedRustProcessor()`, so the engine itself references none of its symbols. `@soundor/engine/web/processor`: `WasmProcessor`, the AudioWorklet and `createProcessorNode()`, moved from the web runtime, apart from `@soundor/engine/web`.
- `@soundor/juce-runtime`: the generated processor uses the engine's bridge; `backend::RustProcessor` becomes `processor::RustProcessor` (`rustProcessor()` returns it), and the JUCE adapter (`JuceRustProcessor.h`) keeps `backend::rustBusLayout()`, `backend::rustTransport()` and `backend::processRust()`.
- `@soundor/web-runtime`: the host loads the engine's processor host only once the plugin has a processor and audio starts. `@soundor/web-runtime/processor` is the engine's entry; `@soundor/web-runtime/client` no longer exports `createProcessorNode`, which `@soundor/web-runtime/processor` has.
