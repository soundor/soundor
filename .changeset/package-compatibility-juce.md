---
'@soundor/juce-runtime': patch
---

Depends on one Soundor package, `@soundor/runtime-sdk`, which its code imports (instead of inlining it): no `@soundor/config` peer, and no `@soundor/core`. It implements runtime API 1, which the CLI checks before running it.
