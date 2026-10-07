---
'@soundor/config': minor
'soundor': minor
'@soundor/juce-runtime': minor
---

macOS code signing. A config can name a signing identity (`signing.macos.identity`), and `SOUNDOR_MACOS_SIGNING_IDENTITY` overrides it; without either, binaries are signed ad-hoc. Runtimes receive the resolved settings as `ctx.signing`, and `soundor doctor` reports the identity, where it came from, and on macOS whether the keychain holds it. The JUCE runtime now signs every macOS bundle as the last build step and verifies the signature, so the VST3 `moduleinfo.json` no longer invalidates it (#63); with a real identity it adds the hardened runtime and a secure timestamp, which notarization requires. `soundor dev` always signs ad-hoc. The JUCE runtime builds with Ninja on macOS and Linux (an existing build tree from another generator is recreated) and keeps Visual Studio on Windows.
