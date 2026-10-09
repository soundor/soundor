---
'@soundor/juce-runtime': patch
---

Faster WebGL calls and less redrawing around WebGL canvases. The generated WebGL methods call native code with no intermediate argument arrays, and uniform-location checks allocate nothing, which halves the cost of `uniform*` calls. Around a WebGL canvas, damage goes to the CPU layer it belongs to, so a change above the canvas no longer redraws the UI below it. A CPU layer that paints nothing is left out of the frame.
