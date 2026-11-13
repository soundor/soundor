---
'@soundor/juce-runtime': patch
---

Add native clang-tidy and no-GPU test presets for the JUCE adapters. CI checks the adapters and test plugin with GCC as well as Clang on Linux, and covers CPU rendering without ANGLE.
