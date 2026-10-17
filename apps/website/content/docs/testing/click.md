---
title: 'user.click'
description: 'Moves the pointer over a node and clicks it with the primary button.'
---

```ts
await user.click(node: NodeTarget): Promise<void>;
```

Moves the pointer over `node` (it is hovered), then presses and releases the
primary button on it: `pointerenter`, `pointermove`, `pointerdown`,
`pointerup` and `click`, with focus moving to the nearest focusable node,
as in the runtime.

```ts
await user.click(screen.getByRole('button', { name: 'Reset gain' }));
expect(parameters.gain.get()).toBe(0.5);
```

## Good to know

- **A disabled or hidden node** is skipped: nothing happens, as for a user.
- **A Pressable's `onPress`** runs from the click, as it would; there is no
  need to call it.
- **For a drag,** or another button, use [`pointer`](/docs/testing/pointer).
