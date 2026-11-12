---
'@soundor/core': minor
'@soundor/config': minor
'@soundor/environment': minor
'@soundor/react': minor
'@soundor/test-runtime': minor
'@soundor/vitest': minor
'@soundor/engine': minor
'@soundor/juce-runtime': minor
'@soundor/web-runtime': minor
---

Add processor-owned StateHistory with opt-in discrete edits, History-enabled parameter/state gestures, synchronous buffered transactions, undo/redo, subscriptions, and useStateHistory(). JavaScript and native C++ share one manager in JUCE; Web and simulated runtimes implement the same contract. History survives editor recreation and clears on project restoration. Runtime API 5 is now required so older runtimes cannot silently ignore History options.
