---
'soundor': minor
'@soundor/config': minor
'@soundor/juce-runtime': minor
'create-soundor-app': minor
---

**Breaking:** a plugin's audio processing is Rust, in the project's `lib/` crate, and the JUCE runtime runs it. `soundor init` scaffolds `lib/` (a processor and its tests) and `rust-toolchain.toml`; `soundor gen` writes the `soundor` crate the processor depends on, the Rust SDK shipped in the `soundor` package, with the config's parameters, read-only parameters, native streams and audio layouts typed for it; `soundor dev` and `soundor build` compile it with Cargo, and `soundor doctor` checks for Rust. The generated `soundor::AudioProcessor` now implements `prepareToPlay()`, `reset()` and `processBlock()` itself and calls the Rust processor through its C ABI: a JUCE processor no longer implements `process()`, and a project's `PluginProcessor` keeps only what is not processing (its editor, its buses without an `audio` declaration, its native API). Runtimes receive the crate as `ctx.lib`.

Rust static libraries link directly using the plugin's existing export controls. Windows needs no LLVM archive/object rewriting tools, and Linux Release binaries still omit debug information.
