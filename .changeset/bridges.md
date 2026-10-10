---
'@soundor/juce-runtime': patch
---

Canvas 2D path commands (`moveTo`, `lineTo`, curves, `arc`, `rect`…) are gathered and sent to native code in one call before the next other call, instead of one call each: a 10,000-point waveform makes 7 native calls a frame instead of 10,007 and draws 23% faster. The most frequent 2D methods no longer make arrays, and the generated WebGL methods look their context up once and convert numbers inline (raw WebGL calls 15% faster).
