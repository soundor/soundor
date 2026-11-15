---
'soundor': patch
'@soundor/juce-runtime': patch
'@soundor/web-runtime': patch
---

Add allocation instrumentation to the Rust processor testing harness and the scaffold's tests. Count allocator calls only while processing, with a required counting allocator so missing instrumentation cannot pass silently. Exercise the Rust SDK, native FFI, JUCE adapter and example processors; compare Orbit's real VST3 output with its WebAssembly build. Document the shared Rust processor lifecycle, generated config contract, Cargo dependencies, runtime boundaries, testing and migration.

Reuse prepared WebAssembly parameter, transport and channel views during processing, including partial and oversized blocks. Preallocate the worklet's channel arrays and silence missing inputs without allocating fallback buffers. Unexpected WASM memory growth fails silently instead of rebuilding views in the callback. Browser publication messages still allocate; these checks do not claim a hard real-time guarantee.
