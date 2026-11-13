---
title: soundor:host
description: Plugin identity, runtime environment, audio settings, track metadata and transport.
---

```ts
import {
  plugin,
  environment,
  getHostState,
  subscribeHostState,
} from 'soundor:host';

plugin.version; // plugin.version in soundor.config; 0.1.0 by default
environment.format; // 'vst3', 'au', 'standalone', 'web', or 'unknown'
getHostState().sampleRate;
const stop = subscribeHostState(({ transport }) =>
  drawPlayhead(transport?.ppqPosition),
);
```

## Exports

| Export                         | Meaning                                                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugin`                       | Frozen `{ id, name, version }` from `soundor.config.ts`.                                                                                     |
| `environment`                  | Frozen `{ runtime, runtimeVersion, platform, arch, format }`, constant for the editor's lifetime.                                            |
| `getHostState()`               | The current immutable `HostSnapshot`. Returns the same object until state changes.                                                           |
| `subscribeHostState(listener)` | Reports new snapshots, every frame while playing. Returns an unsubscribe function; does not call the listener synchronously on registration. |

`getHostState` and `subscribeHostState` replace the previous `snapshot` and
`subscribe` exports. They work with React's
`useSyncExternalStore(subscribeHostState, getHostState)`.

## Environment

| Field            | Values                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------- |
| `runtime`        | Runtime identifier: `juce` or `web` (the simulator uses `test`).                        |
| `runtimeVersion` | Version of the runtime package that generated this plugin.                              |
| `platform`       | `macos`, `windows`, `linux`, `ios`, `android`, or `unknown`.                            |
| `arch`           | Native binary architecture: `arm64`, `x64`, or `unknown`. Always `unknown` in browsers. |
| `format`         | `vst3`, `au`, `standalone`, `web`, or `unknown`.                                        |

The JUCE runtime reports the binary's target OS and architecture, not the
physical CPU's capabilities. Browser OS detection is best effort and may
return `unknown`. No `window`, `document` or `process` global is added by this API.

## HostSnapshot

| Field             | Type                                         | Meaning                                                                      |
| ----------------- | -------------------------------------------- | ---------------------------------------------------------------------------- |
| `sampleRate`      | `number`                                     | Sample rate in Hz.                                                           |
| `blockSize`       | `number`                                     | Configured maximum block size in samples; actual blocks may be smaller.      |
| `hostName`        | `string`                                     | Host identification; JUCE uses its host detector, web reports `Soundor Web`. |
| `hostVersion`     | `string \| undefined`                        | Host version when supplied; currently unavailable in JUCE and web.           |
| `samplePrecision` | `float32 \| float64 \| unknown`              | Processing sample representation.                                            |
| `processingMode`  | `realtime \| prefetch \| offline \| unknown` | Processing mode; JUCE exposes realtime/offline, web uses realtime.           |
| `track`           | `TrackInfo \| undefined`                     | Host-provided track metadata.                                                |
| `transport`       | `Transport \| null`                          | Transport; null until the native host supplies a position.                   |

## Transport

| Field                             | Type                         | Meaning                                                                                    |
| --------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------ |
| `playing`, `recording`, `looping` | `boolean`                    | Playback, recording and loop state.                                                        |
| `bpm`                             | `number`                     | Tempo in beats per minute.                                                                 |
| `timeSignature`                   | `{ numerator, denominator }` | Musical time signature.                                                                    |
| `ppqPosition`                     | `number`                     | Position in quarter notes.                                                                 |
| `barStartPpq`                     | `number`                     | Current bar start in quarter notes.                                                        |
| `timeInSeconds`                   | `number`                     | Position in seconds.                                                                       |
| `timeInSamples`                   | `number`                     | Position in samples.                                                                       |
| `loopStartPpq`, `loopEndPpq`      | `number \| undefined`        | Loop boundaries in quarter notes, when available.                                          |
| `timecode`                        | `Timecode \| undefined`      | `{ framesPerSecond, dropFrame, smpteOffsetSubframes? }`. The offset uses 1/80-frame units. |

Existing transport fields retain their default or previous value if the native
host omits an individual field. New loop/timecode fields are absent when not
reported in the latest captured block. JUCE captures transport on the audio
thread without locking; these snapshots are for UI display, not sample-accurate
DSP scheduling. In web, transport belongs to the host page; its loop boundaries
follow the host's loop region and timecode is unavailable.

## TrackInfo

| Field   | Type                  | Meaning                                                 |
| ------- | --------------------- | ------------------------------------------------------- |
| `name`  | `string \| undefined` | Track/channel display name.                             |
| `color` | `string \| undefined` | CSS hexadecimal RGBA, `#rrggbbaa`.                      |
| `index` | `number \| undefined` | One-based index within the host's channel namespace.    |
| `id`    | `string \| undefined` | Host-defined identifier; stability depends on the host. |

JUCE exposes name and colour through `updateTrackProperties`; index and id
remain unavailable. An override of the generated processor's
`updateTrackProperties` must call the base implementation. Web has no track
metadata. Fields can disappear when the host withdraws them.

The plugin observes this state; it does not control the DAW's transport.
Tests can supply `environment` through the simulated runtime options and
change snapshots through [testHost](/docs/testing/test-host).
