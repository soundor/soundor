---
'@soundor/web-runtime': minor
---

The Web runtime is documented and proven on the example plugin.

- `examples/basic` runs in the browser next to JUCE: the same config and the same `src/main.tsx`, with a `GainNode` in `runtimes/web/src/audio.ts` where JUCE applies the gain in C++. Its static build works below any path and in iframes, each with its own host, transport, audio and plugin view.
- An integration test renders `@soundor/react` (View, Text, Pressable, TextInput, Image, ScrollView, reconciliation) on the DOM `soundor:ui`.
- A dev server that cannot start reports Vite's error. A plugin without native methods is scaffolded `native = {}`.
- The README covers the lifecycle, ownership, the Vite architecture, `soundor:*` in the browser, the native API, Web Audio, the host UI, static and iframe use, limitations, and the post-MVP DSP direction.
