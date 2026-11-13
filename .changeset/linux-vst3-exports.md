---
'@soundor/juce-runtime': patch
---

Limit Linux VST3 dynamic exports to the plugin entry points. This keeps GCC LTO's C++ standard-library instantiations private as well as the linked static runtime, preventing symbol collisions between plugins.
