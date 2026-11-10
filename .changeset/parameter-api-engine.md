---
'@soundor/engine': minor
---

Parameters: `parameters::Info` carries the declared type, access, step and choice options, and `parameters::Host` converts as the plugin does (`constrain`, `toNormalized`, `fromNormalized`, `format`, `parse`). `soundor:parameters` exposes them to JavaScript, and a write to a read-only parameter throws a `TypeError`.
