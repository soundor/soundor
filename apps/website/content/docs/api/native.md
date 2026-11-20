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
- **Implemented** once in Rust: `impl NativeMethods for PluginController`.
  Both the VST3 and web runtimes execute that controller. The generated Rust
  trait enforces every configured method at compile time. See the
  [Rust controller](/docs/rust-controller).

## Events

Native code tells the UI what happened through events: a preset finished
loading, a file failed, an analysis is ready. The config declares each with
the fields of its value, of the same types as arguments:

```ts
// soundor.config.ts
native: {
  events: {
    presetLoaded: { path: 'string', preset: 'Preset?' },
    processingError: { message: 'string' },
    ready: {},
  },
},
```

```ts
// in the UI
import { events } from 'soundor:native';

const unsubscribe = events.presetLoaded.subscribe(({ path, preset }) => {
  console.log('Loaded', path, preset?.name);
});
// later
unsubscribe();
```

```rust
// In a controller method with a TaskContext
ctx.events.preset_loaded(soundor::events::PresetLoadedEvent { path, preset });
ctx.events.ready();
```

Run `soundor gen` after changing an event declaration. A method with an
`AsyncTaskContext` can publish inside `ctx.schedule(|ctx| ...).await`.
VST3 and the web runtime use the same Rust publishers.

- **Delivered on the UI thread, later:** subscribers never run inside the
  call that published the event, and never on the thread that published it.
  VST3 delivers on an editor tick. The web runtime delivers in a
  later turn of the event loop.
- **In order:** a UI receives its events in the order they were published,
  so one thread's events keep their order.
- **From now on:** subscriptions receive events when the runtime delivers
  them. An editor that opens or reloads starts with an empty queue. An event is a notification, not state: what a newly shown component
  needs to read belongs in a method, in [`soundor:state`](/docs/api/state)
  or in a parameter.
- **Bounded:** a UI holds at most 1024 undelivered events; one published
  while it is full is dropped (the publisher returns `false`) and the drop is
  logged. With no UI open, events are dropped. A UI that is slow, hidden or
  closed never makes memory grow.
- **One value for all:** the subscribers of one event receive the same
  object. A subscriber that throws is reported, and the others still run.
- **Audio-rate data:** use a [stream](#streams) for values the processor
  produces in its audio callback.

## Streams

Native code keeps the UI up to date with values it keeps producing, a level,
a spectrum, a playhead, through streams. The UI shows the latest: values it
had no frame for are skipped, never queued. The config declares each as one
number or a `buffer<T>` of numbers, with the most elements one value holds:

```ts
// soundor.config.ts
native: {
  streams: {
    spectrum: { type: 'buffer<float32>', maxLength: 512 },
    peak: { type: 'float32' },
  },
},
```

```tsx
import { useNativeStream } from '@soundor/react';
// in the UI
import { streams } from 'soundor:native';

// React state, re-rendered when a newer value arrives
const peak = useNativeStream(streams.peak);

// or drawn as it arrives, without rendering again
useEffect(() => streams.spectrum.subscribe((spectrum) => draw(spectrum)), []);
```

```rust
// in the Rust processor, on the audio thread
ctx.streams.peak.publish(peak_decibels);
// a buffer, written in place, without a copy:
let bins = ctx.streams.spectrum.buffer_mut(); // 512 floats
fill_spectrum(bins);
ctx.streams.spectrum.commit(bins.len());
```

- **`get()`** returns the latest value the UI received: the same object until
  a newer one arrives, so it works as a store snapshot (that is what
  [`useNativeStream()`](/docs/hooks/use-native-stream) reads), and
  `undefined` before native code published one. A UI that opens, or reloads,
  starts with the value published last.
- **`subscribe(listener)`** calls `listener(value, sequence)` with each newer
  value, at most once a frame. `sequence` counts the values native code
  published, 1 for the first: a gap of more than 1 is how many were skipped.
  `get` and `subscribe` need no `this`.
- **Latest only:** a value replaces the one not yet delivered. A slow UI, a
  subscriber that takes long, a hidden page or a closed editor never makes
  anything pile up, and costs the publisher nothing.
- **Realtime-safe publishing:** `publish()`, and a buffer's `buffer_mut()`
  and `commit()`, take no lock, never allocate (a buffer's storage is
  allocated for `maxLength` when the plugin is made), never wait and never run
  JavaScript, so the audio callback can publish. One thread at a time
  publishes a given stream.
- **Never torn:** the UI reads a value only once it was published whole,
  from memory the publisher no longer writes; a buffer the UI receives is a
  copy of its own, never changed afterwards. Treat it as read-only: its
  subscribers and `get()` share it.
- **Buffers** arrive as typed arrays of the length published, up to
  `maxLength`; publishing more publishes nothing and returns `false`.
  64-bit integers arrive as `bigint`s.
- **Delivered on the UI thread:** the VST3 runtime takes the newest value of
  each stream at its tick (60 times a second), the web runtime at the next
  animation frame. A subscriber that throws is reported, and the others still
  run.

How streams work and what they cost, measured, is in the
[engine reference](/docs/contribute/engine-reference#streams).
[Analyzer](/docs/examples/analyzer) is a complete example.
