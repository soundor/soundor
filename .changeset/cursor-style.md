---
'@soundor/environment': minor
'@soundor/test-runtime': minor
'@soundor/engine': minor
'@soundor/juce-runtime': minor
'@soundor/web-runtime': minor
---

A `cursor` style sets the pointer's shape over a node and its children: `'auto'` (the default, the parent's: the arrow at the root, the I-beam in a text input), `'default'`, `'none'`, `'pointer'`, `'text'`, `'crosshair'`, `'move'`, and the `'ew-'`, `'ns-'`, `'nesw-'` and `'nwse-resize'` cursors. While a pointer is pressed, the pressed node's cursor shows wherever it is dragged. Both runtimes resolve it the same way; the JUCE runtime shows the platform's own cursors.

Hover follows what changes under a pointer that does not move, as in browsers: when the tree, a layout or a scroll puts another node under a still mouse, `pointerleave` and `pointerenter` fire (and Pressable's `onHoverIn`/`onHoverOut`), and the cursor follows, in the next tick or frame.
