---
title: 'fireEvent'
description: 'Low-level event dispatch and pointer/focus helpers below userEvent.'
---

```ts
fireEvent.pointerDown(node, options?);
fireEvent(node, eventName, options?);
```

`fireEvent(node, eventName, options)` dispatches one event on that node.
The named helpers also include runtime pointer and focus operations, described
below. Prefer [`userEvent`](/docs/testing/user-event) for a complete user
action; use these helpers for individual steps or input the session does not
model.

```ts
// A pen, which a userEvent session (a mouse) does not do:
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
| `pointerCancel(node)`                              | Cancels the active press; no event options.                                |
| `keyDown`, `keyUp`                                 | `key`, `code`, `repeat`, modifiers.                                        |
| `beforeInput`, `input`                             | `data`, `inputType`.                                                       |
| `change`                                           | A change event.                                                            |
| `focus`, `blur`                                    | Move actual keyboard focus, firing the resulting focus events.             |
| `accessibilityAction`                              | `actionName`, and `value` for `setValue`.                                  |

`pointerDown` starts capture and focuses the nearest focusable node unless
prevented; a secondary press also fires `contextmenu`. `pointerMove` follows
capture, and `pointerUp` can fire `click` when it completes a primary press.
`pointerCancel(node)` cancels the active press, which may belong to another
node; it takes no event options. `focus` and `blur` call the node's methods.
The other named helpers dispatch their single event.

Fields and names are `soundor:ui`'s ([events](/docs/components/events)).
With the React entry, each dispatch applies React's updates before it
returns.
