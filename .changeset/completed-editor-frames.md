---
'@soundor/juce-runtime': patch
---

List parameters in the order the config declares them, as the web host does, rather than sorted by id. Apply `requestEditorSize()` at most once a frame, on the UI timer, rather than per input event, which starved the host's thread during a fast drag. Present only completed CPU-rendered frames from native paint callbacks. The UI timer settles JavaScript updates before rendering at the new editor size, preventing mixed-layout images during native resizing and expose events. Scale-mode editors retain raster density while their size keeps changing and sharpen after a short pause, avoiding repeated canvas allocations, with no round trip on the X connection each frame, which could leave a click waiting for the next event.
