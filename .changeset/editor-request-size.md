---
'@soundor/environment': minor
'@soundor/test-runtime': minor
'@soundor/testing-library': minor
'@soundor/vitest': minor
'@soundor/engine': minor
'@soundor/juce-runtime': minor
'@soundor/web-runtime': minor
---

`soundor:ui` gains `requestEditorSize(width, height)`: plugin code asks for another editor size, held to the editor's limits (and, scaling, its aspect ratio), which the host gives or not; `editorSize().resizable` says whether it can ask (false for a fixed editor and in `?embed`). Pointer events gain `screenX`/`screenY`, the pointer on the screen in the editor's pixels, so a resize grip drawn by the UI measures its drag in units the resize does not change. The JUCE editor applies requests with `setSize()` after the UI's code ran, telling the host; the Web host resizes its viewport as its handle does. The test runtime simulates requests (`testEditor.requests()`, `editor: { resizable, minWidth, …, aspectRatio, applyRequests }`). The Basic and Orbit examples draw a grip of their own.
