---
'soundor': minor
'@soundor/config': minor
'@soundor/runtime-sdk': minor
'@soundor/vitest': minor
'@soundor/juce-runtime': minor
'@soundor/web-runtime': minor
'create-soundor-app': minor
---

Projects no longer list `@soundor/core`. It is now a regular dependency of every package that imports it, instead of a peer dependency the project had to provide. The CLI, `@soundor/config`, `@soundor/runtime-sdk` and `@soundor/vitest` pin the exact version their release group shares, so a project still gets one copy. The runtimes take it with a caret range. New projects from `create-soundor-app` no longer include it, and an existing project can remove it from its `devDependencies`.
