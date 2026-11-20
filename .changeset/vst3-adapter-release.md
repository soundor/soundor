---
'@soundor/vst3-runtime': patch
'@soundor/engine': patch
---

The VST3 runtime's prebuilt adapters are a GitHub release of their own, like the engine's archives, instead of being in the npm package. The package carries `artifacts/manifest.json`, and a build downloads the adapter for its platform and variant once into the Soundor cache (`vst3-adapters/`), checking its SHA-256 and size. `SOUNDOR_VST3_ADAPTER_MANIFEST` names another manifest. `@soundor/engine/archives` exposes the engine's cache and archive installer for this.
