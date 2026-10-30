---
'@soundor/environment': minor
'@soundor/core': minor
---

`@soundor/environment` declares `soundor:host`, `soundor:storage` and `soundor:fs` too, so libraries can use them, and it is now the source of every declaration that is the same for all plugins: core copies its files into `.soundor/generated` and generates only `soundor:parameters` and `soundor:native`. `plugin.id` and `plugin.name` in `soundor:host` are typed `string`, no longer as the config's literal values. Core no longer exports `runtimeTypeFiles()`.
