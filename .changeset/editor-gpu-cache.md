---
'@soundor/engine': patch
---

An editor's GPU-drawn 2D canvases keep at most 32 MB of textures for later, down from 64 MB. What they keep is freed once it has gone unused for 10 seconds, not only when the cache is full.
