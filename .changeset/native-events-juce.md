---
'@soundor/juce-runtime': minor
---

Native events in C++: with `native.events`, `SoundorNative.h` declares a struct per event in `soundor::native::events` and `soundor::native::Events`, one publisher per event, and the processor owns one as `nativeEvents`: `nativeEvents.presetLoaded({ .path = path })` from any thread but the audio callback, and every open editor receives it at its next tick. `install()` then takes the events too (`install(context, api, events)`, `api` nullptr when there are no methods), and the editor installs them into every runtime.
