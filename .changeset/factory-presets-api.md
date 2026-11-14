---
'@soundor/config': minor
'@soundor/core': minor
'@soundor/environment': minor
'@soundor/runtime-sdk': minor
'@soundor/test-runtime': minor
'@soundor/vitest': minor
'@soundor/engine': minor
'@soundor/juce-runtime': minor
'@soundor/web-runtime': minor
---

Declare validated factory presets in config and load them synchronously through soundor:presets or the generated C++ processor. Share the existing parameter/state stores and StateHistory, including opt-in atomic undo entries, nested transactions, selection and modified tracking, and restoration matching. Expose JUCE host programs from the same catalog; preserve DAW state/preset compatibility without changing the snapshot format. Include matching Web and simulated runtime APIs.
