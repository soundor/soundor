---
'@soundor/juce-runtime': minor
---

The generated editor runs on the engine's `editor::Editor`, which places the UI from soundor.config's `editor` at run time instead of generated C++. It keeps only the JUCE side: the component and its timer, JUCE's input where there is no native input, the size limits it learns from the host, and the CPU raster kept during a resize. The editor now also places the UI when it is resized on the CPU. Accessibility's screen bounds no longer apply a host's scale factor twice.
