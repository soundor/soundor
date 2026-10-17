---
title: 'user.tab'
description: 'Moves keyboard focus with Tab, or back with Shift+Tab.'
---

```ts
await user.tab(options?: { shift?: boolean }): Promise<void>;
```

Presses Tab (or Shift+Tab with `shift: true`): focus moves to the next (or
previous) focusable node, as in the runtime, within the innermost trapping
[`FocusScope`](/docs/components/focus-scope).

```ts
await user.tab();
expect(screen.getByRole('adjustable', { name: 'Gain' })).toHaveFocus();
await user.tab({ shift: true });
```

## Good to know

- **Tab through a UI** to check its keyboard order, and that every control is
  reachable: assert where focus is with
  [`toHaveFocus`](/docs/testing/to-have-focus).
- **A modal traps focus:** Tab cycles inside it while it is open.
