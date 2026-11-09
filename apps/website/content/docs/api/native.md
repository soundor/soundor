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
    Analysis: { struct: { rms: 'float32', peak: 'float32' } },
    Preset: { struct: { name: 'string', gains: 'float32[]' } },
  },
  methods: {
    analyze: { args: { samples: 'buffer<float32>' }, returns: 'Analysis' },
    loadPreset: { args: { path: 'string' }, returns: 'Preset?', async: true },
    setSolo: { args: { slot: 'int32?' } },
  },
},
```

```ts
// in the UI
import { analyze, loadPreset } from 'soundor:native';

const { rms } = analyze(samples); // samples: Float32Array
const preset = await loadPreset('presets/warm.json'); // Preset | null
if (preset) preset.gains.map((gain) => gain * 2);
setSolo(null);
```

- **Methods** take their arguments in the order declared and return
  `returns` (nothing by default); `async: true` methods return a promise.
- **Types:** `boolean`, `string`, sized numbers (`int8` … `uint64`,
  `float32`, `float64`; 64-bit integers are `bigint`s), structs (plain
  objects), enums (string unions), and three ways to compose them:
  - `T[]`, an array: a list of values, copied across;
  - `buffer<T>`, contiguous binary numbers of one numeric type: a typed array
    (`buffer<float32>` is a `Float32Array`);
  - `T?`, nullable: `T` or `null` (an argument is still required).

  Every value is data: a struct the UI can read and change, never a
  reference to a native object. The [config reference](/docs/cli/config#native)
  has the full table and the C++ each becomes.

- **Checked:** every argument is checked before native code runs, and
  nothing is coerced; a mismatch is a `TypeError` naming the path
  (`centroid(): points[1].y: expected float64, got undefined`), a number out
  of range a `RangeError`. A native exception becomes an `Error`.
- **Implemented** once per runtime: in C++ for the JUCE runtime
  ([JUCE runtime](/docs/juce-runtime)), in `runtimes/web/src/native.ts` for the
  web runtime ([web runtime](/docs/web-runtime)). `soundor gen` generates the
  interface each must implement, so a method added to the config is a
  compile error until it is.
