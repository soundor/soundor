---
'@soundor/vst3-runtime': patch
'soundor': patch
---

Report dynamic VST3 tail duration from Rust with `ctx.report_tail_seconds(seconds)` in `prepare()` or `process()`. VST3 hosts read the latest report when they query the processor. A fixed tail continues to use the configured duration.
