---
'soundor': minor
'@soundor/config': minor
'@soundor/core': minor
'@soundor/juce-runtime': minor
'@soundor/runtime-sdk': minor
'create-soundor-app': minor
---

Plugin UIs are TypeScript/TSX bundled with tsdown and run inside the plugin.

- `soundor dev`/`soundor build` bundle `src/main.tsx` (or `.ts`/`.jsx`/`.js`) into one ES module: npm packages inlined, `soundor:*` imports kept, minified for production, source-mapped for development. Image imports (`.png`, `.jpg`, `.jpeg`, `.webp`) become content-addressed assets. Runtimes receive the bundle as `ctx.ui`.
- The JUCE runtime compiles the bundle into the plugin and the editor's runtime evaluates it.
- `soundor gen` emits `globals.d.ts`: the Web APIs the runtime provides and image imports, for `lib: ["ES2023"]` projects without DOM types.
- New projects get a `src/main.ts` entry and runtime-appropriate tsconfigs.
