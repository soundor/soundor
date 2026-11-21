---
title: 'fireEvent'
description: 'Low-level event dispatch and pointer/focus helpers below userEvent.'
---

```ts
fireEvent.pointerDown(node, options?);
fireEvent(node, eventName, options?);
```

`fireEvent(node, eventName, options)` dispatches one event on that node.
Direct dispatch bypasses runtime input eligibility, including disabled state.
The named helpers also include runtime pointer and focus operations, described
below. Prefer [`userEvent`](/docs/testing/user-event) for a complete user
action; use these helpers for individual steps or input the session does not
model.

```ts
// A single pen press with explicit event fields:
fireEvent.pointerDown(canvas, {
  pointerType: 'pen',
  pressure: 0.5,
  clientX: 10,
});
// A screen reader's action:
fireEvent.accessibilityAction(knob, { actionName: 'increment' });
```

| Method                                             | Event                                                                      |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| `pointerDown`, `pointerMove`, `pointerUp`, `click` | Pointer events: `clientX`, `button`, `pointerType`, `pressure`, modifiers… |
| `dblClick`                                         | A `dblclick` (`detail` 2 by default), on its own.                          |
| `pointerCancel(node, { pointerId }?)`              | Cancels the active press for a pointer (default ID 0).                     |
| `keyDown`, `keyUp`                                 | `key`, `code`, `repeat`, modifiers.                                        |
| `beforeInput`, `input`                             | `data`, `inputType`.                                                       |
| `change`                                           | A change event.                                                            |
| `focus`, `blur`                                    | Move actual keyboard focus, firing the resulting focus events.             |
| `accessibilityAction`                              | `actionName`, and `value` for `setValue`.                                  |

On an enabled target, the first `pointerDown` starts capture and focuses the nearest focusable node
unless prevented; it also fires `contextmenu` if the secondary button starts
the press. While any button stays held, additional presses and releases fire
`pointermove` with the changed `button` and updated `buttons` mask, without
changing focus or opening a context menu. `pointerMove` follows capture, and
the last `pointerUp` ends it and fires `click` if it releases the primary button
over a node that shares an ancestor with the pressed node.
The first press's `detail` is its click count (1 by default), which its `click`
reports: `fireEvent.pointerDown(node, { detail: 2 })` makes the second click
of a double click, and its release fires `dblclick` after the `click`.
`click` alone has `detail` 1 unless given another.
`pointerCancel(node)` cancels the active press, which may belong to another
node. Pass a `pointerId` to cancel a particular pen or touch contact.
`focus` and `blur` call the node's methods.
The other named helpers dispatch their single event.

Fields and names are `soundor:ui`'s ([events](/docs/primitives/events)).
With the React entry, each dispatch applies React's updates before it
returns.
