---
title: 'userEvent'
description: 'Acts as a user does: a session that clicks, types, presses keys and moves the pointer.'
---

```ts
const user = userEvent.setup(options?: { delay?: number; advanceTimers?: (ms: number) => unknown });
```

`userEvent.setup()` starts a session that acts as a user: it keeps which
buttons and keys are held and where focus is, sends the whole sequence of
events an action makes, and lets the runtime's default actions follow (focus
moving, a text input editing). It never calls a component's props directly.

```ts
const user = userEvent.setup();
await user.click(screen.getByRole('button', { name: 'Open' }));
await user.type(screen.getByRole('textinput', { name: 'Name' }), 'Warm');
await user.keyboard('{Enter}');
```

| Method                                          | What it does                                                 |
| ----------------------------------------------- | ------------------------------------------------------------ |
| [`click(node)`](/docs/testing/click)            | Moves the pointer over the node and clicks it.               |
| [`dblClick(node)`](/docs/testing/dbl-click)     | Moves the pointer over the node and double-clicks it.        |
| [`press(node)`](/docs/testing/press)            | Focuses a control and presses Enter.                         |
| [`type(input, text)`](/docs/testing/type)       | Clicks a text input and types the text.                      |
| [`clear(input)`](/docs/testing/clear)           | Clicks a text input and deletes its text.                    |
| [`keyboard(keys)`](/docs/testing/keyboard)      | Presses keys, with held modifiers.                           |
| [`tab(options?)`](/docs/testing/tab)            | Moves focus with Tab, or Shift+Tab.                          |
| [`pointer(actions)`](/docs/testing/pointer)     | Moves, presses, and releases mouse, pen, and touch pointers. |
| `wheel(node, options?)`                         | Sends wheel input with the held modifiers.                   |
| `accessibilityAction(node, actionName, value?)` | Performs an action the node offers to assistive technology.  |

## Wheel and screen-reader actions

```ts
await user.wheel(knob, { deltaY: -1, deltaMode: 1 });
await user.accessibilityAction(slider, 'increment');
await user.accessibilityAction(slider, 'setValue', 0.5);
```

`wheel` accepts `deltaX` and `deltaY` (both default to 0), and `deltaMode`
(0 for pixels, 1 for lines, 2 for pages). It updates hover before dispatch
unless the mouse is captured, and leaves focus modality unchanged. Unless
prevented, it scrolls the nearest node that can scroll in the requested
direction. Shift turns a purely vertical delta into a horizontal scroll;
Control suppresses default scrolling. Page-mode events are delivered but do
not scroll by default because the test runtime has no layout.

`accessibilityAction` rejects if the node is not exposed in the accessibility
tree, does not offer the action, or is disabled. An offered `focus` or `blur`
is allowed on a disabled node. Focus from assistive technology is shown as
keyboard focus.

## Options

| Option          | What it does                                                                              |
| --------------- | ----------------------------------------------------------------------------------------- |
| `delay`         | Milliseconds of Node time between steps: 0 by default.                                    |
| `advanceTimers` | With Vitest's fake timers and a `delay`: how to move them, `vi.advanceTimersByTimeAsync`. |

## Good to know

- **One session per test,** made in the test: it belongs to the test's
  runtime.
- **Await every action.**
- **Disabled and hidden nodes** are skipped by pointer and wheel actions.
  A node from another test, or removed, throws.
- **With fake timers,** keep the frame functions real and give the session
  a way to move time:

```ts
vi.useFakeTimers({
  toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
});
const user = userEvent.setup({
  delay: 1,
  advanceTimers: vi.advanceTimersByTimeAsync,
});
```
