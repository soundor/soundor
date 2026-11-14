---
'@soundor/config': minor
'@soundor/core': minor
'@soundor/test-runtime': patch
'@soundor/engine': minor
'@soundor/juce-runtime': minor
'@soundor/web-runtime': minor
---

Declare plugin kind, categories and vendor metadata, audio buses and complete supported layouts, latency/tail reporting, parameter groups and a host bypass role. Generate JUCE host integration and explicit browser channel counts, with validation for unsupported browser buses. Existing projects retain handwritten audio setup unless they opt into the audio contract. MIDI and presets are separate features.
