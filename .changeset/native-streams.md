---
'@soundor/config': minor
'@soundor/core': minor
'soundor': minor
'@soundor/test-runtime': minor
'@soundor/testing-library': minor
'@soundor/vitest': minor
'@soundor/engine': minor
'@soundor/juce-runtime': minor
'@soundor/web-runtime': minor
---

**Breaking:** native channels are now called native streams, so they are not confused with an audio buffer's channels. The behavior is unchanged: they still go from audio to the UI only, keep only the latest value, deliver at most one value per frame, and publish without locks or allocations.

- Config: `native.channels` is now `native.streams`, and no method can be called `streams`.
- UI: `import { streams } from 'soundor:native'`, typed `NativeStream<T>`.
- Rust: `ctx.streams.peak.publish(…)`. `soundor::Streams`, `ValueStream`, `BufferStream` and `StreamElement` replace `Channels`, `ValueChannel`, `BufferChannel` and `ChannelElement`. `TestProcessor::stream()` and `stream_buffer()` replace `channel()` and `channel_buffer()`.
- C++: `soundor::native::Streams` replaces `native::Channels`, and the processor's member is `nativeStreams`. The engine's `soundor/js/Streams.h` declares `js::ValueStream<T>` and `js::BufferStream<T>`, with `js::deliverStreams()`, `bind::connectStreams()` and `bind::installStreams()`. `TickStatistics::streams` replaces `TickStatistics::channels`.
- Tests: `publishStream(name, value)` from `@soundor/testing-library` replaces `publishChannel()`.
- Web: the generated contract exports `streams` to the project's `runtimes/web` code. `@soundor/engine/web`'s processor takes `streams` and reports changes through `onStreams`.

The Rust processor's binary interfaces keep their layout and their WebAssembly export names (`soundor_wasm_channel_*`), so the processor ABI version is unchanged.
