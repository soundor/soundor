---
'@soundor/juce-runtime': minor
'create-soundor-app': minor
'soundor': minor
'@soundor/core': minor
'@soundor/config': minor
'@soundor/runtime-sdk': minor
'@soundor/react': minor
---

New projects and the example are React apps, and two Soundor plugins are proven to coexist in one host.

- `create-soundor-app` scaffolds a `src/main.tsx` React UI with `@soundor/react`.
- `soundor:host`'s `snapshot()` returns the same object until the host state changes, so it works with `useSyncExternalStore(subscribe, snapshot)`. A fresh object on every call made React loop.
- A coexistence test loads two copies of the runtime under different ABI namespaces into one process and runs them interleaved, unloading and reloading them. A JUCE host test does the same with two real VST3s and their editors.
