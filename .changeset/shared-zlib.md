---
'@soundor/engine': patch
---

Build ANGLE against Skia's zlib instead of its own copy, so a plugin contains one zlib, and test that no two dependency archives define the same C symbol.
