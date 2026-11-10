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
parameters.gain.format(); // the value as the host shows it, unit included
parameters.gain.info; // { id, label, access, type, min, max, default, step, unit }
```

In React, [`useParameter`](/docs/hooks) reads one and re-renders
on its changes. The [Parameters guide](/docs/parameters) shows how to declare
them and connect them to audio.

## `parameters`

One object per declared parameter, by `id`, typed from the config: a
numeric parameter's value is a `number` (in its range, on its step's grid), a
`boolean`'s a `boolean`, a `choice`'s one of its options' `value`s.

| Member                     | What it does                                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get()`                    | The current value.                                                                                                                                                                                            |
| `set(value)`               | Sets the value and tells the host. Numbers are clamped to the range and snapped to the step; a value of the wrong type, a choice value that is not an option, or any write to a `readOnly` parameter, throws. |
| `subscribe(listener)`      | Calls `listener` with the new value after every change, whoever made it (the UI, the host's automation, a preset, the processing). Returns a function that unsubscribes.                                      |
| `beginGesture()`           | Starts a user's edit (a drag): the host records the changes until `endGesture()` as one.                                                                                                                      |
| `endGesture()`             | Ends it.                                                                                                                                                                                                      |
| `format(value?)`           | The value (the current one by default) as hosts show it: `'1.25 kHz'`.                                                                                                                                        |
| `parse(text)`              | Typed text as a value, as hosts read it; `null` when it is not one.                                                                                                                                           |
| `toNormalized(value?)`     | The value's (the current one's by default) position in [0, 1], through the parameter's mapping.                                                                                                               |
| `fromNormalized(position)` | The value at a position in [0, 1] (clamped), mapped and snapped: what a knob there sets.                                                                                                                      |
| `info`                     | The declaration: `id`, `label`, `access`, `type`, `default`, and `min`, `max`, `step`, `unit` (numbers) or `options` (choices).                                                                               |
| `id`                       | The parameter's id.                                                                                                                                                                                           |

- **Changes coalesce.** Subscribers hear changes, not repeated writes of the
  same value, and a burst of changes (automation from the audio thread)
  reaches them once a frame, with the latest value.
- **Gestures nest:** nested gestures reach the host as one, an unmatched
  `endGesture()` is ignored, and a gesture still open when the UI reloads is
  ended.
- **The types** are generated into `.soundor/generated/parameters.d.ts`, so
  `parameters.gain` exists exactly when the config declares `gain`.
