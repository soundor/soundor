---
'@soundor/juce-runtime': patch
---

Depends on `@soundor/runtime-sdk`, which its code imports, instead of inlining it, and on `@soundor/config`, whose `RuntimeFactory` types its factory, instead of declaring it a peer. It implements runtime API 1, which the CLI checks before running it.
