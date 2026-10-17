---
'@soundor/engine': patch
---

Images drawn much smaller than their pixels no longer alias: bundled images get mipmaps when decoded, and image nodes are drawn between the two nearest.
