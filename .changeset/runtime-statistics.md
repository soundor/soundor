---
'@soundor/juce-runtime': patch
---

`RuntimeHost::statistics()` says what a host did, for profiling: the time each step of `tick()` took, calls into `soundor:ui`, Canvas 2D and WebGL (timed too with `RuntimeOptions::timeNativeCalls`), the engine's allocations and heap, style changes, layout passes and invalidations. `soundor_run_ui` reports them per frame and per phase, and counts ticks that render nothing.
