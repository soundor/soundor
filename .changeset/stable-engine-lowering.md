---
'@soundor/engine': patch
---

Bundle the JavaScript lowering tool's runtime dependencies and capture their build-time identity, so fresh installs of a published engine keep selecting its prebuilts even after Babel releases new versions. Workspace builds still track installed lowering dependencies.
