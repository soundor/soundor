---
title: 'waitFor'
description: 'Retries an assertion until it passes: for storage, native calls and effects that settle later.'
---

```ts
await waitFor(callback: () => T | Promise<T>, options?: { timeout?: number; interval?: number }): Promise<T>;
```

Calls `callback` until it stops throwing (or rejecting), and resolves with
what it returned; after `timeout` it rejects with the last error. For what
settles later: storage, files, native async methods, effects.

```ts
await user.keyboard('{Enter}');
await waitFor(async () => expect(await storage.get('presetName')).toBe('Warm'));
```

| Option     | Default | What it is               |
| ---------- | ------- | ------------------------ |
| `timeout`  | 1000 ms | How long to keep trying. |
| `interval` | 20 ms   | How long between tries.  |

The `findBy…` [queries](/docs/testing/queries) are `waitFor` around a
`getBy…`: `await screen.findByText('Saved')`.

## Good to know

- **Assert inside, do not act:** the callback runs many times; an action in
  it runs as many.
- **Animations do not move while it waits:** their time is
  [`advanceTime`](/docs/testing/advance-time)'s. Vitest's fake Node timers
  do advance.
- **For what is synchronous,** assert directly: a click's result is there
  once `await user.click(…)` resolves.
