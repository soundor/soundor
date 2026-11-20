---
'@soundor/vst3-runtime': patch
---

The editor runs on the engine's `editor::Editor`, the engine's shared editor:

- An editor with `resize: 'layout'` and a maximum size keeps its layout at the maximum, centred (`fit: 'contain'`), or covers the view and reports the maximum as its safe area (`fit: 'cover'`), when a host makes it larger.
- On the GPU, a resize presents at the new size at once instead of on the next frame.
- `requestEditorSize()` is available only when the size limits allow another size.
- Debug builds show the `SOUNDOR_SHOW_RENDERER=1` badge.
