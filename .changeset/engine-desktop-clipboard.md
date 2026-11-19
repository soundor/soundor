---
'@soundor/engine': minor
'@soundor/juce-runtime': patch
'@soundor/vst3-runtime': patch
---

Use the engine's native text clipboard on Linux, Windows and Apple platforms. The direct VST3 editor now exchanges clipboard text with the Linux desktop. JUCE uses the same engine clipboard API on each platform.
