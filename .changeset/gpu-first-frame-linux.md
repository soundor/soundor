---
'@soundor/engine': patch
---

On Linux, the editor no longer stays black with the GPU compositor until an input event or a resize. The first frame was presented before the host mapped its window, so the X server dropped it, and a UI that did not change was never presented again. The compositor's window now asks for its Expose events, and the editor presents again when the compositor needs it (`GpuCompositor::needsRedraw()`: placed or shown anew, or exposed), even without a UI change. A new compositor is placed and shown before its first frame.
