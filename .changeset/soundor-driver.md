---
'@soundor/driver': minor
'soundor': minor
'@soundor/react': minor
'@soundor/core': minor
'@soundor/test-runtime': minor
'@soundor/engine': minor
'@soundor/web-runtime': minor
---

Soundor Driver: `@soundor/driver` connects to a running plugin's DevTools session as a control client and inspects its native UI (targets, the node tree, node details, and lazy locators by debug ID, role or text); `soundor driver targets|tree|inspect` does the same from the command line, with `--json` output and stable exit codes. Components take a `debugId` prop (`node.debugId` in `soundor:ui`), which DevTools shows and the Driver finds nodes by.
