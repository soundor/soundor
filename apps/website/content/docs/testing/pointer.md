---
title: 'user.pointer'
description: 'Moves the mouse and presses its buttons step by step: drags, held buttons, secondary clicks.'
---

```ts
await user.pointer(actions: PointerAction | PointerAction[]): Promise<void>;

interface PointerAction {
  target?: NodeTarget; // the node; the previous one when omitted
  keys?: string;       // '[MouseLeft]', '[MouseLeft>]', '[/MouseLeft]', also MouseRight, MouseMiddle
  clientX?: number;    // and clientY, offsetX, offsetY, movementX, movementY, modifiers…
}
```

Each action moves the pointer to its target, then presses, holds or releases
a button when `keys` says so. A drag is a press held, moves, and a release:

```ts
const knob = screen.getByRole('adjustable', { name: 'Gain' });
await user.pointer({ target: knob, keys: '[MouseLeft>]', clientY: 40 });
await user.pointer({ target: knob, clientY: 32 });
await user.pointer({ target: knob, keys: '[/MouseLeft]', clientY: 32 });
```

| `keys`         | What it does                     |
| -------------- | -------------------------------- |
| `[MouseLeft]`  | Presses and releases the button. |
| `[MouseLeft>]` | Presses it, and keeps it down.   |
| `[/MouseLeft]` | Releases it.                     |
| _(none)_       | Moves only.                      |

`MouseRight` (a secondary click: `onContextMenu`) and `MouseMiddle` work the
same.

## Good to know

- **Targets are explicit:** a test has no layout, so nothing can be hit by
  position. The first action needs a `target`; later ones keep it.
- **Coordinates are the event's:** give `clientX`/`clientY` (or `offsetX`/
  `offsetY`) that the code under test reads, a drag's distance say.
- **Capture is implicit:** while a button is down, the pressed node gets the
  moves, wherever they go, until the last button is released.
- **Pointer lock works as in the runtimes:** a `requestPointerLock()` from
  the press's `pointerdown` locks it until the release, and moves give it
  their `movementX`/`movementY`:
  `await user.pointer({ target: knob, movementY: -30 })`.
- **A mouse only:** pen and touch events go through
  [`fireEvent`](/docs/testing/fire-event).
