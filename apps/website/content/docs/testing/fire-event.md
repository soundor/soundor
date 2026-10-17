---
title: 'fireEvent'
description: 'Sends one event to a node, and nothing else: the escape hatch below userEvent.'
---

```ts
fireEvent.pointerDown(node, options?);
fireEvent(node, eventName, options?);
```

`fireEvent` dispatches one event on a node: no hovering first, no click
after, no focus change. Prefer [`userEvent`](/docs/testing/user-event),
which does what a user does; reach for `fireEvent` for what a session does
not model.

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

| Method                                                              | Event                                                                      |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `pointerDown`, `pointerMove`, `pointerUp`, `pointerCancel`, `click` | Pointer events: `clientX`, `button`, `pointerType`, `pressure`, modifiers… |
| `keyDown`, `keyUp`                                                  | `key`, `code`, `repeat`, modifiers.                                        |
| `beforeInput`, `input`                                              | `data`, `inputType`.                                                       |
| `change`, `focus`, `blur`                                           | —                                                                          |
| `accessibilityAction`                                               | `actionName`, and `value` for `setValue`.                                  |

Fields and names are `soundor:ui`'s ([events](/docs/components/events)).
With the React entry, each dispatch applies React's updates before it
returns.
