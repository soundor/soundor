---
'soundor': minor
'@soundor/config': minor
'@soundor/runtime-sdk': minor
'@soundor/core': minor
'@soundor/juce-runtime': minor
'@soundor/web-runtime': minor
---

The runtime that runs another form of the UI now makes that form itself. The CLI bundles the UI into one ES module, `bundle.mjs`. The JUCE runtime lowers it for Hermes with the `toNativeModule()` of the engine it links (`@soundor/engine/native-module`), into `.soundor/cache/juce/ui-debug` or `ui-release`. The lowering therefore always matches the plugin's engine, and a web-only project no longer pays for it.

`ctx.ui.entry` is removed. In `soundor dev`, `ctx.ui.live` gains `onBuild(listener)` and `sourceMap(file, mapFile)`, so that a runtime can remake its form after every build and have its stack frames mapped. `@soundor/core` no longer depends on `@soundor/engine` and no longer exports `toNativeModule()`; import it from `@soundor/engine/native-module`.
