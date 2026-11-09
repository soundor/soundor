---
title: 'user.dblClick'
description: 'Moves the pointer over a node and double-clicks it with the primary button.'
---

```ts
await user.dblClick(node: NodeTarget): Promise<void>;
```

Moves the pointer over `node`, then clicks it twice with the primary
button, the second press counted as the second of a series: a `click` with
`detail` 1, then a `click` and a `dblclick` with `detail` 2, as a platform
counts a double click.

```ts
await user.dblClick(screen.getByRole('adjustable', { name: 'Gain' }));
expect(parameters.gain.get()).toBe(parameters.gain.info.default);
```

## Good to know

- **No timing:** the session says which press of a series each one is, so a
  test never depends on a double-click time. Two `user.click()` calls are
  two single clicks, however close.
- **A disabled or hidden node** is skipped: nothing happens, as for a user.
- **For another count,** a triple click say, give the press its `detail`
  with [`pointer`](/docs/testing/pointer):
  `{ target, keys: '[MouseLeft]', detail: 3 }`.
