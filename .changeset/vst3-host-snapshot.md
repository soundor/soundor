---
'@soundor/vst3-runtime': patch
---

Expose the VST3 host name, track metadata, processing mode, loop bounds, and SMPTE timecode through `soundor:host` when the host provides them. Report sample precision as `float32`.

Keep the in-process link alive so the editor can read the processor's audio settings and transport.
