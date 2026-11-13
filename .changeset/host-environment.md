---
'@soundor/config': minor
'@soundor/environment': minor
'@soundor/test-runtime': minor
'@soundor/vitest': minor
'@soundor/engine': minor
'@soundor/juce-runtime': minor
'@soundor/web-runtime': minor
---

Expose plugin version and runtime environment in soundor:host, and extend host state with processing mode, sample precision, optional track metadata, loop boundaries and timecode. Rename snapshot/subscribe to getHostState/subscribeHostState. Configure plugin.version (default 0.1.0) consistently across formats.
