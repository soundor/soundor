---
'@soundor/test-runtime': patch
---

The simulated runtime fires `scroll` from code as the real ones do: once at the next frame, also for `scrollTop` and `scrollLeft`, and not when the position did not move.
