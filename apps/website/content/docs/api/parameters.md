---
title: soundor:parameters
description: The plugin's parameters, shared with the audio and the host.
---

The parameters `soundor.config.ts` declares, as typed objects. They are
shared with the audio (DSP) side and the host: the host automates them,
saves them in projects and presets, and the UI moves them.

```ts
import { parameters } from 'soundor:parameters';

parameters.gain.get(); // a number, in the declared range
parameters.gain.set(0.75);
const stop = parameters.gain.subscribe((gain) => draw(gain));
parameters.gain.info; // { id, label, type, min, max, default, unit }
```

In React, [`useParameter`](/docs/api/react#hooks) reads one and re-renders
on its changes. The [Parameters guide](/docs/parameters) shows how to declare
them and connect them to audio.

## `parameters`

One object per declared parameter, by `id`, typed from the config: a
`float` or `int` parameter's value is a `number`, a `bool`'s a `boolean`,
an `enum`'s one of its values.

| Member                | What it does                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get()`               | The current value.                                                                                                                                        |
| `set(value)`          | Sets the value and tells the host. Numbers are clamped to the range, and ints rounded; a value of the wrong type, or not one of an enum's values, throws. |
| `subscribe(listener)` | Calls `listener` with the new value after every change, whoever made it (the UI, the host's automation, a preset). Returns a function that unsubscribes.  |
| `beginGesture()`      | Starts a user's edit (a drag): the host records the changes until `endGesture()` as one.                                                                  |
| `endGesture()`        | Ends it.                                                                                                                                                  |
| `info`                | The declaration: `id`, `label`, `type`, `default`, and `min`, `max`, `unit` (numbers) or `values` (enums).                                                |
| `id`                  | The parameter's id.                                                                                                                                       |

- **Changes coalesce.** Subscribers hear changes, not repeated writes of the
  same value, and a burst of changes (automation from the audio thread)
  reaches them once a frame, with the latest value.
- **Gestures nest:** nested gestures reach the host as one, an unmatched
  `endGesture()` is ignored, and a gesture still open when the UI reloads is
  ended.
- **The types** are generated into `.soundor/generated/parameters.d.ts`, so
  `parameters.gain` exists exactly when the config declares `gain`.
