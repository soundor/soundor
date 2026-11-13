---
'@soundor/engine': patch
---

Keep Skia's system libraries after the ANGLE/Skia archives when linking a prebuilt engine. Fixes unresolved fontconfig and FreeType symbols with GCC and GNU ld in JUCE integration consumers.
