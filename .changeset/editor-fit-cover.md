---
'@soundor/config': minor
'@soundor/environment': minor
'@soundor/test-runtime': minor
'@soundor/testing-library': minor
'@soundor/engine': minor
'@soundor/juce-runtime': minor
'@soundor/web-runtime': minor
---

A resizable editor's limits are now what it asks for. By default it opens at its size and only grows, without a maximum: `minWidth`/`minHeight` default to the opening size, and `maxWidth`/`maxHeight` to `Infinity` (which a config may also write). The limits, and the aspect ratio of an editor that scales (`editor.keepAspectRatio`, default `true`), are offered to hosts that ask and kept by the Standalone and the web host's handle; a host that sets a larger window or another shape regardless (Ardour) gets it, the minimum only held. `editor.fit` decides what the UI does in such a window, for every resizable editor: `'contain'`, the default, lays it out at most at its maximum (or, scaling, at its zoom, capped by the maximum) in the middle, with bands of the editor's background; `'cover'` lays it out over the whole window, `viewSize().safeArea` (and `useViewSize()`) saying where the part it was made for is. The web host applies the same rules in `?embed`, where the page owns the size, and hides its handle where the limits allow no other size. `soundor:ui` adds `editorSize()` and `subscribeEditorSize()`, the editor's actual size in its own logical pixels, told once per change whoever resized it. `EditorConfig` is now a union that allows `fit` only with `resizable: true` and `keepAspectRatio` only with `resize: 'scale'` (validation rejects `fit: 'cover'` and `keepAspectRatio: true` elsewhere), and reports a maximum below the opening size; `ResolvedEditorConfig` always has both, and `DEFAULT_EDITOR_LIMITS` is gone. In tests, `testView.resize({ safeArea })` sets the safe area and `testEditor.resize()` the editor's size.
