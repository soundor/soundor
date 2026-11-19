---
'@soundor/vst3-runtime': minor
'soundor': patch
---

Add `@soundor/vst3-runtime`: Linux VST3 plugins without JUCE. A prebuilt,
generic VST3 adapter (Steinberg's VST3 SDK 3.8.1) hosts the Soundor engine
and the project's Rust processor and controller; `soundor build vst3` links
them into a `.vst3` bundle, with no C++ compiled per plugin. The Rust SDK's
controller now reads and edits `int8`, `uint8`, `int16`, `uint16` and
`uint32` parameters (they failed to compile before).
