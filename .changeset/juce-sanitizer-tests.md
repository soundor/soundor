---
'@soundor/juce-runtime': patch
---

Add a native sanitizer preset for JUCE adapter, persistent-state and DevTools tests, with ASan, UBSan and leak detection. Apply sanitizer flags to the JUCE integration targets as well as the source engine.
