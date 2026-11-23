---
'@soundor/engine': patch
---

Opening and closing an editor no longer leaves about 1 MB of font data behind each time. Each editor made its own font manager and its own typeface for every registered font, which copied the font file again, and Skia kept glyph caches for those typefaces after the editor closed. Editors open at the same time now share one font manager and one typeface per font file. When the last editor closes, the typefaces are released and Skia's font caches are purged.
