---
'@soundor/core': minor
'@soundor/config': minor
'@soundor/runtime-sdk': minor
'@soundor/react': minor
'@soundor/test-runtime': minor
'@soundor/vitest': minor
'@soundor/juce-runtime': minor
'@soundor/web-runtime': minor
---

Add typed persistent application state through `soundor:state`, reusing native type declarations and validated defaults, with field subscriptions and React `useStateValue()`.

JUCE owns state per processor, saves parameters and state together, accepts legacy APVTS projects, and calls the protected `stateRestored()` hook on the message thread after each complete restoration. Off-thread host restorations queue to that thread. Web hydrates before application startup and automatically saves snapshots to application-namespaced IndexedDB. Runtime API 2 gates state configuration for older runtimes.
