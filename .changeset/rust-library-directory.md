---
'soundor': minor
'@soundor/config': minor
'@soundor/runtime-sdk': minor
'create-soundor-app': minor
'@soundor/web-runtime': minor
'@soundor/juce-runtime': minor
'@soundor/engine': patch
---

**Breaking:** the plugin's Rust processor and controller library now lives in `lib/`. Rename `native/` to `lib/`, update Cargo manifest paths in scripts and tooling, and run `soundor gen`. Legacy and ambiguous layouts produce a migration error without changing user files.

Runtime authors must use `ctx.lib`, `LibraryBuildContext`, `LibraryBuildRequest`, and `LibraryArtifact` in place of the Rust crate's native-named context and types. Cargo options, processor/controller ABI, and the public `soundor:native` methods/events API are unchanged. Both JUCE and Web compile the same library for their targets.
