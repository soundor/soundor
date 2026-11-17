---
'@soundor/engine': patch
'@soundor/juce-runtime': patch
---

Move Apple accessibility class registration into the prebuilt engine and remove the per-plugin Objective-C++ shim and Apple module pinning. Invalidate retained macOS accessibility elements and custom actions during teardown. Registered classes persist without explicit disposal; physical plugin unloading remains a documented safety risk.
