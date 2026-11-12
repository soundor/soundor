---
'@soundor/engine': patch
---

`soundor_run_ui` reports the process's resident memory: at startup (with the engine's heap, in the startup record and on stderr) and per frame's largest sample (`rssBytesMax` per phase) — the floor a plugin editor gets with nothing of its own in it, for the benchmark's memory work.
