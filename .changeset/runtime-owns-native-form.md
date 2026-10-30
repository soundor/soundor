---
'@soundor/core': minor
'@soundor/config': minor
'@soundor/runtime-sdk': minor
'soundor': minor
'@soundor/react': minor
'@soundor/juce-runtime': minor
'@soundor/web-runtime': minor
'@soundor/vitest': minor
---

The runtime that runs another form of the UI now makes it. The CLI bundles the UI into one ES module, `bundle.mjs`. The JUCE runtime lowers that module for Hermes with the `toNativeModule()` of the engine it links (`@soundor/engine/native-module`), into `.soundor/cache/juce/ui-debug` or `ui-release`. The lowering therefore always matches the plugin's engine, and a web-only project no longer pays for it. `ctx.ui.entry` is gone. In `soundor dev`, `ctx.ui.live` gains `onBuild(listener)` and `sourceMap(file, mapFile)`, so that a runtime can remake its form after every build and have its stack frames mapped. `@soundor/core` no longer depends on `@soundor/engine` and no longer exports `toNativeModule()`. Core now has no dependencies.

Assets are plain strings. `soundor:ui` exports `Asset` (a bundled image's or font's id, a `string`) in place of the global, branded `SoundorAsset`. Image and font imports are declared in a new `assets.d.ts`, apart from the Web globals. A library can therefore compile against `@soundor/core/runtime/ui.d.ts` with the DOM's types and its own bundler's asset declarations. A new guide, "Writing a UI library", covers this.

Projects no longer list `@soundor/core`. It is now a regular dependency of every package that imports it, instead of a peer dependency the project had to provide. The CLI, `@soundor/config`, `@soundor/runtime-sdk` and `@soundor/vitest` pin the exact version their release group shares, so a project still gets one copy. The runtimes take it with a caret range. New projects from `create-soundor-app` no longer include it, and an existing project can remove it from its `devDependencies`.
