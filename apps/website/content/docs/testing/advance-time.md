---
title: 'advanceTime'
description: 'Moves the simulated clock: animations, frames and timers, without waiting.'
---

```ts
await advanceTime(milliseconds: number): Promise<void>;
```

Moves the test runtime's clock forward, a frame at a time: animations
advance (and finish, and fire their events), `requestAnimationFrame` and
`useAnimationFrame` callbacks run, and React's updates between frames are
applied. Nothing actually waits.

```ts
await user.click(screen.getByRole('button', { name: 'Hide' }));
await advanceTime(250);
expect(screen.getByText('Preset loaded').presentation.opacity).toBe(0);
```

## Good to know

- **Time does not move on its own** in a test: an animation stays at its
  start until `advanceTime`.
- **Check where an animation is with `node.presentation`**: the style is the
  target, the presentation what shows now.
- **Vitest's fake timers** move with it, when they are on.
