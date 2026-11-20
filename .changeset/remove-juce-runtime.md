---
'create-soundor-app': minor
'soundor': minor
'@soundor/engine': patch
'@soundor/vst3-runtime': patch
---

Remove the JUCE runtime: `@soundor/vst3-runtime` builds the same plugins as VST3s on Linux, macOS and Windows, without JUCE, CMake or C++ compiled per plugin. Replace `juceRuntime({ ... })` with `vst3Runtime()` in `soundor.config.ts` and `@soundor/juce-runtime` with `@soundor/vst3-runtime` (and its peer `@soundor/vst3-host`) in `package.json`; `soundor dev vst3` and `soundor build vst3` replace their `juce` forms, and builds go to `.soundor/dist/vst3/`. There are no AU or Standalone builds.

`create-soundor-app` offers the VST3 and web runtimes. The engine's WebGL codegen is `pnpm --filter @soundor/engine gen:webgl`.
