---
'@soundor/web-runtime': patch
---

Declares the Soundor versions it supports, `soundor.compatibility` in its `package.json`: `@soundor/config` and `@soundor/core` `>=0.16.0 <0.18.0`, config schema 1, which the CLI checks before running it. It depends on `@soundor/runtime-sdk`, which its code imports, instead of inlining it, and on `@soundor/config`, whose `RuntimeFactory` types its factory, instead of declaring it a peer.
