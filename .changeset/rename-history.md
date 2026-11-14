---
'@soundor/environment': minor
'@soundor/core': minor
'@soundor/react': minor
'@soundor/vitest': minor
'@soundor/engine': minor
'@soundor/juce-runtime': minor
'@soundor/web-runtime': minor
---

Rename `soundor:state-history` to `soundor:history`, its `stateHistory` export to `history`, and its `StateHistory` interface to `History`. Rename the React hook to `useHistory` and the generated JUCE processor member to `history`. Update imports, hook calls, and native member access to the new names.
