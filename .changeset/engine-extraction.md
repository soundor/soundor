---
'@soundor/engine': minor
'@soundor/core': minor
'@soundor/runtime-sdk': minor
'@soundor/juce-runtime': minor
---

Extract the backend-independent native engine into its own source package. Resolve it through normal package resolution, expose Soundor::Engine, and derive the C++ ABI from its exact version. Keep Apple class registration in a small shim compiled per plugin binary and preserve unloading protections.

Move Hermes module lowering into the engine and preserve the core re-export, so ordinary core releases do not cascade into engine versions. Preserve exact stored JUCE float values when reading parameters, avoiding a lossy normalized round trip on platforms with fused floating-point arithmetic.
