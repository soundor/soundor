---
'@soundor/engine': minor
'@soundor/environment': minor
'@soundor/web-runtime': minor
'@soundor/test-runtime': minor
---

Add soundor:ui createSvg and the bounded, atomic SVG scene protocol v1. SVG roots are Yoga leaves with normal input and accessibility. Native scenes retain Skia geometry with shared path caching and damage tracking; Web scenes use native SVG elements. Add scene update, path parse and draw counters to native benchmark reports. This protocol requires engine 0.6.0 or later; React components follow through the existing React package.
