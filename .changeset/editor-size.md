---
'@soundor/config': minor
'@soundor/runtime-sdk': minor
'@soundor/juce-runtime': minor
---

A config's `editor` sets the plugin editor's size, the same in every runtime: `width` and `height` (800×600 by default), and with `resizable: true` limits the user can resize it within (`minWidth`, `minHeight`, `maxWidth`, `maxHeight`; 480×320 to 1600×1200 by default). Without it, an editor is a fixed 800×600 view as before. `resolveEditor()` gives a runtime every field decided. The JUCE runtime's generated editor opens at that size and, when resizable, lets the host resize it within its limits; the UI is laid out again at the new size, and under the GPU compositor presented at it at once.
