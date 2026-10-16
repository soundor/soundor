---
'@soundor/juce-runtime': minor
'@soundor/engine': minor
---

JUCE plugins link the prebuilt engine by default: `juceRuntime({ engine: { mode: 'prebuilt' } })` downloads the Debug or Release libraries of the installed engine's prebuilt release for the platform the plugin targets into the Soundor cache, verifies their SHA-256 and reuses them offline; `{ mode: 'source' }` compiles the engine as before. Prebuilt mode never falls back to compiling: an engine without a release (a workspace or unpublished copy), an unsupported target or a failed download stops the configure, naming source mode. The published engine names its release in `artifacts/manifest.json`. `soundor doctor` reports the engine a build will use. The JUCE DevTools bridge compiles into every plugin and is active only with a DevTools engine.
