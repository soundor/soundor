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

| Method                                      | What it does                                   |
| ------------------------------------------- | ---------------------------------------------- |
| [`click(node)`](/docs/testing/click)        | Moves the pointer over the node and clicks it. |
| [`press(node)`](/docs/testing/press)        | Focuses a control and presses Enter.           |
| [`type(input, text)`](/docs/testing/type)   | Clicks a text input and types the text.        |
| [`clear(input)`](/docs/testing/clear)       | Clicks a text input and deletes its text.      |
| [`keyboard(keys)`](/docs/testing/keyboard)  | Presses keys, with held modifiers.             |
| [`tab(options?)`](/docs/testing/tab)        | Moves focus with Tab, or Shift+Tab.            |
| [`pointer(actions)`](/docs/testing/pointer) | Moves and presses mouse buttons, step by step. |

## Options

| Option          | What it does                                                                              |
| --------------- | ----------------------------------------------------------------------------------------- |
| `delay`         | Milliseconds of Node time between steps: 0 by default.                                    |
| `advanceTimers` | With Vitest's fake timers and a `delay`: how to move them, `vi.advanceTimersByTimeAsync`. |

## Good to know

- **One session per test,** made in the test: it belongs to the test's
  runtime.
- **Await every action.**
- **Disabled and hidden nodes** are skipped, as a user could not reach them.
  A node from another test, or removed, throws.
- **A mouse and a keyboard:** pen and touch are not part of a session; send
  their events with [`fireEvent`](/docs/testing/fire-event).
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
