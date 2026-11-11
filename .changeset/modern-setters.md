---
'@soundor/core': minor
'@soundor/config': minor
'@soundor/test-runtime': minor
'@soundor/engine': minor
'@soundor/juce-runtime': minor
'@soundor/web-runtime': minor
---

Accept synchronous functional updaters on parameter and persistent state fields. Resolve once against the latest immutable store value, validate before publishing, and reject asynchronous results. Automatically bracket changed automatable parameter writes in a host gesture when no explicit gesture is active, preserving nested gestures and keeping state gestures explicit.

Raise the runtime API version to 4 for the compatible setter addition; older runtime API versions remain supported.
