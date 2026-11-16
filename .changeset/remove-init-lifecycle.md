---
'soundor': minor
'@soundor/config': minor
'@soundor/runtime-sdk': minor
'create-soundor-app': minor
'@soundor/juce-runtime': minor
'@soundor/web-runtime': minor
---

Remove the `soundor init` command and runtime initialization hook. Runtime authors
now implement only `gen`, `dev`, `build`, and `doctor`. Both first-party hosts
remain package-managed, including the legacy-host migration diagnostics.

`soundor gen` creates a Rust starter crate when `native/Cargo.toml` is absent, preserving
existing files and leaving existing crates untouched; development and builds run it automatically. Check mode remains read-only.
New projects run generation after dependency installation.
