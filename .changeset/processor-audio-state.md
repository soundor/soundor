---
'@soundor/core': minor
'@soundor/config': minor
'soundor': minor
'@soundor/engine': minor
'@soundor/juce-runtime': minor
'@soundor/web-runtime': minor
---

**Breaking (processor ABI 2):** the Rust audio processor can read persistent state. A state field declared with `audio: true` keeps its usual persistence, presets and History, and the processor also reads it as `ctx.state` in `prepare()` and `process()`. `ctx.state` is a generated `soundor::StateSnapshot` that holds only the `audio: true` fields, typed as declared, so reading a UI-only field fails to compile. An audio field is a number, a boolean, or an array of them with a `maxLength` (`StateArray<T, N>`, which reads as a slice). `maxLength` is an array's capacity. Any array field may declare one, and every value of the field is checked against it on every write path (sets, restored projects, factory presets, History).

A change reaches the next block. A block sees one snapshot from start to end, and fields written together arrive together. Reading takes no lock, allocates nothing and copies nothing. Natively, the engine's `processor::AudioState` (a triple buffer that `PersistentState::audioState()` owns) hands snapshots to the audio thread. In the browser, the page posts each snapshot to the AudioWorklet (`ProcessorNode.setState()`), which writes it into the module between render quanta.

The processor ABI is now version 2: `SoundorPrepare` and `SoundorBlock` carry the state, and `SoundorProcessorInfo` and `RustContract` its size. Rebuild a plugin's processor with this SDK. `TestProcessor::state_mut()` sets the state in tests.
