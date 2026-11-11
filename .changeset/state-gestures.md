---
'@soundor/core': minor
'@soundor/juce-runtime': minor
'@soundor/web-runtime': minor
'@soundor/test-runtime': minor
'@soundor/vitest': minor
---

Add optional beginGesture() and endGesture() methods to persistent state fields in JavaScript and native JUCE code. Gestures nest per field, leave writes immediate, reset on restoration, and clean up unfinished UI interactions without host automation or History recording.

Raise the runtime API version to 3 for the additional state field methods; older runtimes remain accepted.
