---
'soundor': patch
'@soundor/config': patch
'@soundor/core': patch
'@soundor/vst3-runtime': patch
---

`soundor gen` no longer stamps the generated Rust SDK with the CLI's version: its manifest keeps `version = "0.0.0"`, so updating Soundor no longer rewrites a project's `lib/Cargo.lock`. Third-party notices still name the SDK at the CLI's version, from the new `ctx.lib.sdk` (its manifest and version) and `crateNotices`' `versions` option, which the VST3 runtime also uses for its own `soundor-vst3` crate.
