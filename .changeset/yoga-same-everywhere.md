---
'@soundor/engine': patch
---

Yoga is compiled without fused multiply-add, so a layout is the same on arm64 as on x86 and in the web runtime. Rarely, a layout near zero free space on Apple Silicon changes to match them.
