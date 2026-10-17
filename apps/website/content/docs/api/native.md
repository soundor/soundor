---
title: soundor:native
description: The plugin's own typed native API, declared in its config.
---

The functions a plugin's native code offers its UI: analysis, file formats,
licensing, anything the plugin implements in C++ (or, in the web runtime, in
TypeScript). The config declares them, with their types:

```ts
// soundor.config.ts
native: {
  types: {
    Analysis: { struct: { rms: 'number', peak: 'number' } },
    Preset: 'handle',
  },
  methods: {
    analyze: { args: { samples: 'Float32Array' }, returns: 'Analysis' },
    loadPreset: { args: { path: 'string' }, returns: 'Preset', async: true },
  },
},
```

```ts
// in the UI
import { analyze, loadPreset } from 'soundor:native';

const { rms } = analyze(samples);
const preset = await loadPreset('presets/warm.json');
```

- **Methods** take their arguments in the order declared and return
  `returns` (nothing by default); `async: true` methods return a promise.
- **Types:** primitives, binary data (`ArrayBuffer`, typed arrays), structs
  (plain objects), enums (string unions), arrays, and handles: opaque objects
  only native code can make. The [config reference](/docs/cli/config#native)
  has the full table and the C++ each becomes.
- **Checked:** every argument is checked before native code runs; a
  mismatch is a `TypeError` naming the path (`centroid(): points[1].y:
  expected number, got undefined`). A native exception becomes an `Error`.
- **Implemented** once per runtime: in C++ for the JUCE runtime
  ([JUCE runtime](/docs/juce-runtime)), in `runtimes/web/src/native.ts` for the
  web runtime ([web runtime](/docs/web-runtime)). `soundor gen` generates the
  interface each must implement, so a method added to the config is a
  compile error until it is.
