---
title: soundor:host
description: The plugin's identity, the host it runs in, and the host's transport.
---

What the plugin knows of where it runs: its own identity, the host's audio
settings and name, and the transport (playing, tempo, position).

```ts
import { plugin, snapshot, subscribe } from 'soundor:host';

plugin.name; // from soundor.config
snapshot().sampleRate;
const stop = subscribe(({ transport }) => drawPlayhead(transport?.ppqPosition));
```

## Exports

| Export                | What it is                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `plugin`              | `{ id, name }`, from `soundor.config.ts`, typed as their literal values.                                                                |
| `snapshot()`          | The host's state now: a `HostSnapshot`.                                                                                                 |
| `subscribe(listener)` | Calls `listener` with each new snapshot when the host's state changes: every frame while playing. Returns a function that unsubscribes. |

## `HostSnapshot`

| Field        | Type                | What it is                                               |
| ------------ | ------------------- | -------------------------------------------------------- |
| `sampleRate` | `number`            | The audio's sample rate, in Hz.                          |
| `blockSize`  | `number`            | The audio's block size, in samples.                      |
| `hostName`   | `string`            | The host's name, when the plugin can tell (`"Reaper"`).  |
| `transport`  | `Transport \| null` | The host's transport; `null` until the host reports one. |

## `Transport`

| Field           | Type      | What it is                                       |
| --------------- | --------- | ------------------------------------------------ |
| `playing`       | `boolean` | Whether the host plays.                          |
| `recording`     | `boolean` | Whether it records.                              |
| `looping`       | `boolean` | Whether it loops.                                |
| `bpm`           | `number`  | The tempo, in beats per minute.                  |
| `timeSignature` | `object`  | `{ numerator, denominator }`: 4/4 is `{ 4, 4 }`. |
| `ppqPosition`   | `number`  | The musical position, in quarter notes.          |
| `barStartPpq`   | `number`  | Where the current bar starts, in quarter notes.  |
| `timeInSeconds` | `number`  | The position in seconds.                         |
| `timeInSamples` | `number`  | The position in samples.                         |

The plugin observes the transport; it never controls it. In the JUCE
runtime the transport is captured on the audio thread without locking; in
the web runtime it is the host page's own ([web runtime](/docs/web-runtime)).
