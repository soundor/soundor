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

```cpp
// in the plugin (JUCE): any thread but the audio callback
nativeEvents.presetLoaded({ .path = path, .preset = preset });
```

- **Delivered on the UI thread, later:** subscribers never run inside the
  call that published the event, and never on the thread that published it.
  The JUCE runtime delivers at its next tick (60 times a second), the web
  runtime right after the publishing code returns.
- **In order:** a UI receives its events in the order they were published,
  so one thread's events keep their order.
- **From now on:** a subscriber receives the events published after it
  subscribed, none from before; a UI that opens, or reloads, starts with
  none. An event is a notification, not state: what a newly shown component
  needs to read belongs in a method, in [`soundor:state`](/docs/api/state)
  or in a parameter.
- **Bounded:** a UI holds at most 1024 undelivered events; one published
  while it is full is dropped (the publisher returns `false`) and the drop is
  logged. With no UI open, events are dropped. A UI that is slow, hidden or
  closed never makes memory grow.
- **One value for all:** the subscribers of one event receive the same
  object. A subscriber that throws is reported, and the others still run.
- **Not for audio-rate data:** publishing allocates and takes a short lock,
  so it is not for the audio callback, and an event per audio block is too
  many. Use a [channel](#channels) for values the audio thread keeps
  producing.

## Channels

Native code keeps the UI up to date with values it keeps producing, a level,
a spectrum, a playhead, through channels. The UI shows the latest: values it
had no frame for are skipped, never queued. The config declares each as one
number or a `buffer<T>` of numbers, with the most elements one value holds:

```ts
// soundor.config.ts
native: {
  channels: {
    spectrum: { type: 'buffer<float32>', maxLength: 512 },
    peak: { type: 'float32' },
  },
},
```

```tsx
import { useSyncExternalStore } from 'react';
// in the UI
import { channels } from 'soundor:native';

// React state, re-rendered when a newer value arrives
const peak = useSyncExternalStore(channels.peak.subscribe, channels.peak.get);

// or drawn as it arrives, without rendering again
useEffect(() => channels.spectrum.subscribe((spectrum) => draw(spectrum)), []);
```

```cpp
// in the plugin (JUCE): the audio callback included
nativeChannels.peak.publish(peakDecibels);
nativeChannels.spectrum.publish(std::span<const float>(magnitudes)); // copied
// or written in place, without a copy:
auto bins = nativeChannels.spectrum.buffer(); // 512 floats
fillSpectrum(bins);
nativeChannels.spectrum.commit(bins.size());
```

- **`get()`** returns the latest value the UI received: the same object until
  a newer one arrives, so it works as `useSyncExternalStore`'s snapshot, and
  `undefined` before native code published one. A UI that opens, or reloads,
  starts with the value published last.
- **`subscribe(listener)`** calls `listener(value, sequence)` with each newer
  value, at most once a frame. `sequence` counts the values native code
  published, 1 for the first: a gap of more than 1 is how many were skipped.
  `get` and `subscribe` need no `this`.
- **Latest only:** a value replaces the one not yet delivered. A slow UI, a
  subscriber that takes long, a hidden page or a closed editor never makes
  anything pile up, and costs the publisher nothing.
- **Realtime-safe publishing (JUCE):** `publish()`, and a buffer's `buffer()`
  and `commit()`, take no lock, never allocate (a buffer's storage is
  allocated for `maxLength` when the plugin is made), never wait and never run
  JavaScript, so the audio callback can publish. One thread at a time
  publishes a given channel.
- **Never torn:** the UI reads a value only once it was published whole,
  from memory the publisher no longer writes; a buffer the UI receives is a
  copy of its own, never changed afterwards. Treat it as read-only: its
  subscribers and `get()` share it.
- **Buffers** arrive as typed arrays of the length published, up to
  `maxLength`; publishing more publishes nothing and returns `false`.
  64-bit integers arrive as `bigint`s.
- **Delivered on the UI thread:** the JUCE runtime takes the newest value of
  each channel at its tick (60 times a second), the web runtime at the next
  animation frame. A subscriber that throws is reported, and the others still
  run.

How channels work and what they cost, measured, is in the
[engine reference](/docs/contribute/engine-reference#channels).
[Analyzer](/docs/examples/analyzer) is a complete example.
