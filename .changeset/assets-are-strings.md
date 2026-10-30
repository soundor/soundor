---
'@soundor/core': minor
'@soundor/react': minor
---

Assets are plain strings. `soundor:ui` exports `Asset`, a bundled image's or font's id (a `string`), in place of the global, branded `SoundorAsset`. `Image`'s `source` takes an `Asset`. Image and font imports are declared in their own `assets.d.ts` in `.soundor/generated`, apart from the Web globals.
