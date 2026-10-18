---
title: 'Interacting with UI'
description: 'Click, hover, drag, scroll, focus and type in a running plugin, through the engine’s own input dispatch.'
---

Soundor Driver sends input to the running plugin the way a mouse and a
keyboard do: the engine hit-tests the point, captures the pointer while a
button is down, dispatches the events through the node tree, and runs the
plugin's default actions (focus on press, scrolling, text editing). The
plugin's handlers run because the events reach them, never because the Driver
calls them: a `Pressable`'s `onPress` runs from a real press and release.

## Locator actions

```ts
const reset = driver.getByDebugId('reset');
await reset.click();
await reset.click({ button: 'right' });
await driver.getByRole('adjustable', { name: 'Gain' }).drag({ deltaY: -100 });
await driver.getByDebugId('preset-list').scroll({ deltaY: 120 });
await driver.getByDebugId('meter').hover();
await driver.getByDebugId('name').type('Warm pad');
await driver.getByDebugId('name').press('Enter');
await driver.getByDebugId('name').focus();
```

| Action                            | What it does                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `click(options)`                  | Moves the pointer to the node, presses and releases a button (`left` by default). |
| `hover(options)`                  | Moves the pointer over the node.                                                  |
| `drag({ deltaX, deltaY, steps })` | Presses on the node, moves in `steps` (5) by the deltas, releases.                |
| `dragTo(locator, options)`        | Drags the node onto another node's center.                                        |
| `scroll({ deltaX, deltaY })`      | Moves the pointer over the node and scrolls the wheel by the deltas, in pixels.   |
| `focus()`                         | Gives a focusable node keyboard focus, as `node.focus()` does.                    |
| `press(key)`                      | Focuses the node, then presses a key: `Enter`, `ArrowUp`, `Control+a`.            |
| `type(text)`                      | Focuses the node, then types the text, a key press per character.                 |

Pointer actions act at the center of the node's [bounds](/docs/driver/inspecting#coordinates),
or at `position: { x, y }` from its top-left corner. All take `modifiers`
(`['Shift']`), `timeout` and `signal`.

## Actionability

Before pointer input, an action waits until the node can take it, as a user
would see it:

- exactly one node matches (several fail at once with `AMBIGUOUS_ELEMENT`);
- it is visible, has a size, and is not disabled (`accessibilityState.disabled`,
  a disabled `Pressable`);
- the point is inside the view;
- nothing covers it there: the engine's hit test at the point reaches the node
  or a node inside it, so an overlay, a modal or a portal on top blocks it.

The action looks again after short pauses (20 ms up to 250 ms) until
`timeout` (the Driver's command timeout, 10 seconds by default), and follows
the node through re-renders and reloads. It fails with `ELEMENT_NOT_FOUND`
when no node ever matched, and `ELEMENT_NOT_ACTIONABLE` with the last reason
otherwise ("is covered at (220, 20) by node 6"). Once input was sent, it is
never sent again: a failed click is not retried into a double click.

`focus()` needs a focusable node (a text input, a `Pressable`, a view with
`focusable`); another fails with `ELEMENT_NOT_ACTIONABLE`.

## Low-level input

`driver.pointer` and `driver.keyboard` send input where you say, in the
view's logical pixels:

```ts
await driver.pointer.move(100, 200);
await driver.pointer.down(); // { button: 'left' }
await driver.pointer.move(100, 120);
await driver.pointer.up();
await driver.pointer.click(40, 40, { button: 'right' });
await driver.pointer.wheel({ deltaY: 120 }); // at the pointer
await driver.pointer.cancel(); // ends a press without a click

await driver.keyboard.down('Shift');
await driver.pointer.click(40, 40); // a shift-click
await driver.keyboard.up('Shift');
await driver.keyboard.press('Control+z');
await driver.keyboard.type('Hello');
```

Keys are `KeyboardEvent.key` values: `a`, `A`, `Enter`, `Escape`,
`ArrowLeft`, `Backspace`, `Tab`, `Shift`. They go to the focused node (the
root without one). A printable key types its character when the plugin does
not handle the key and neither Control nor Meta is held, as a keyboard does.
Modifier keys held with `keyboard.down()` apply to later pointer and key
input; `modifiers` adds others to one input. `press('Shift+a')` holds Shift
around the key, and releases it whatever happens.

`hitTest(x, y)` says what is at a point without sending input: the deepest
node there and its ancestors.

## The synthetic pointer

## Other clients

Driver input uses a pointer of its own (a mouse, `pointerId` 32000 or the
next one free), next to the real mouse: its hover, presses and capture never
mix with a person's using the plugin at the same time.

Other clients (DevTools tabs, other Drivers) send input at the same time,
without asking first: each client has its own pointer and its own held keys,
so another client's held Shift or pressed button is never this one's. What
they share is the view's focus: keys go to the focused node, as two
keyboards on one computer would, and two clients typing at once interleave.
Each Driver sends its own input one command at a time, in order.

## Cleanup

Nothing stays pressed:

- a `drag()` or `press()` interrupted by an error or a cancelled signal ends
  its press (a `pointercancel`) or releases its modifiers;
- disconnecting, or the connection dropping, makes the engine end whatever
  this Driver held, and nothing another client holds: a pressed button gets
  a `pointercancel` (no click), held keys a `keyup`;
- a reload starts the new UI with nothing held.

## Security

The engine compiles input automation with DevTools only: Debug builds with
DevTools enabled, which `soundor build` never makes, so a released plugin has
none. In development it takes the session's browser key, from the loopback
only: any client signed in to the session can send input. Targets advertise it as the `input`
capability, separate from inspection.
