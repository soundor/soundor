---
'@soundor/engine': patch
'@soundor/web-runtime': patch
'@soundor/environment': patch
---

The JUCE and web runtimes lay out more styles the same. Natively, a box with no room (in a container squeezed to zero) keeps its content's size rather than its padding's (Yoga's shortcut for it is patched out), and a fixed `width` or `height` counts in a parent sized by its content after its `min*`/`max*` clamp. In the browser, `flex: n` (or a fixed `flexBasis`) adds only its basis to a row sized by its content, and `aspectRatio` wins over the stretch as in Yoga (with both sizes given, the one along the parent's direction stays). The cases that still differ are listed in the web runtime's guide, "Where layout differs".
