---
'@soundor/engine': patch
---

Rename the symbols of the libjpeg-turbo, libpng and libwebp copies inside Skia to `soundor_*`, so plugins link against JUCE 9, which bundles the same libraries with plain C names.
