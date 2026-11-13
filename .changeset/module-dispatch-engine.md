---
'@soundor/engine': minor
---

`RuntimeHost::Options::dispatchModules`: a backend's own modules (state, History) deliver what they queued for JavaScript from inside `tick()`, right after the parameter changes, under the tick's one time limit, timed as `TickStatistics::modules`, and in every runtime a dev reload creates.
