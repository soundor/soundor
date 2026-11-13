---
'@soundor/juce-runtime': minor
---

Native channels in C++: with `native.channels`, `SoundorNative.h` declares `soundor::native::Channels`, a `js::ValueChannel<T>` or `js::BufferChannel<T>` per channel, and the processor owns one as `nativeChannels`, which `process()` can publish to without locking or allocating (`nativeChannels.peak.publish(level)`, or `nativeChannels.spectrum.buffer()` filled in place, then `commit()`). Every open editor takes the newest value at its tick. `install()` takes the channels too (`install(context, api, events, channels)`, with what the config declares), and the editor installs them into every runtime.
