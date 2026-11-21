---
title: 'user.pointer'
description: 'Simulates mouse, pen, and touch input step by step.'
---

```ts
await user.pointer(actions: PointerAction | PointerAction[]): Promise<void>;

interface PointerAction {
  target?: NodeTarget; // the node; the previous one when omitted
  keys?: string;       // '[MouseLeft]', '[MouseLeft>]', '[/MouseLeft]', also MouseRight, MouseMiddle
  pointerType?: 'mouse' | 'pen' | 'touch';
  pointerName?: string; // a held touch contact to move, e.g. 'TouchA'
  clientX?: number;    // and clientY, offsetX, offsetY, screenX, screenY, movementX, movementY, modifiers…
  detail?: number;     // a press: which of a series it is (1 by default; 2 makes a double click)
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

`MouseRight` and `MouseMiddle` use the same syntax. Only the first press fires
`pointerdown` and only the last release fires `pointerup`. In between, button
changes fire `pointermove` with the changed `button` and updated `buttons` mask.
A secondary press fires `contextmenu` only if no other button is held.
The first press's `detail` is its click count, as a platform counts them: a
second click is `{ target, keys: '[MouseLeft]', detail: 2 }`, whose release
fires `click` and then `dblclick` ([`dblClick`](/docs/testing/dbl-click) does
both clicks).

## Touch and pen

Use `[TouchA>]` to start a held contact, `pointerName: 'TouchA'` to move it,
and `[/TouchA]` to release it. `[TouchA]` is a tap. Names run from `TouchA`
to `TouchZ`. Each contact gets its own pointer ID and capture. The first
contact is primary; lifting it does not promote another held contact. Touch
does not synthesize hover or support pointer lock in the test runtime.

```ts
await user.pointer([
  { target: pad, keys: '[TouchA>]' },
  { target: pad, keys: '[TouchB>]' },
  { pointerName: 'TouchA', clientX: 20 },
  { keys: '[/TouchA]' },
  { keys: '[/TouchB]' },
]);
```

For pen, set `pointerType: 'pen'` on each action and use the mouse key
descriptors. The pen has its own hover and capture, and accepts `pressure`.

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
- **Cancellation is system input:** use
  [`fireEvent.pointerCancel`](/docs/testing/fire-event) with the contact's
  `pointerId`.
