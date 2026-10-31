---
'@soundor/config': minor
'@soundor/juce-runtime': minor
'@soundor/web-runtime': minor
---

`editor.resize: 'scale'` makes a resizable editor zoom rather than lay its UI out again: the UI stays laid out at `width`×`height`, and resizing draws it larger or smaller, keeping its aspect ratio (default limits: half and twice the size). In JUCE the editor keeps its aspect ratio and draws the surface at the zoom, converting pointer, wheel, pointer lock and accessibility coordinates; in the web host the handle sets the zoom, and `embed` fills the iframe at the editor's layout. `useViewSize()` keeps `width` and `height` and reports the zoom in `scale`. The default, `resize: 'layout'`, is unchanged.
