---
'@soundor/engine': minor
'@soundor/juce-runtime': minor
---

Extract the backend-independent native engine into its own source package. Resolve it through normal package resolution, expose Soundor::Engine, and derive the C++ ABI from its exact version. Keep Apple class registration in a small shim compiled per plugin binary and preserve unloading protections.
