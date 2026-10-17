---
title: 'toHaveFocus'
description: 'Asserts that a node has keyboard focus.'
---

```ts
expect(node).toHaveFocus();
expect(node).not.toHaveFocus();
```

Passes when `node` has keyboard focus in Soundor's sense: portals and nested
dialogs included. The `soundor()` plugin adds it to Vitest's `expect`; there
is nothing to set up.

```ts
await user.tab();
expect(screen.getByRole('button', { name: 'Open dialog' })).toHaveFocus();
```

## Good to know

- **Check keyboard order** with it: [`tab`](/docs/testing/tab) through the
  UI and assert where focus lands.
- **A node from another test,** or removed, fails clearly, even with `.not`.
- **Types:** they come with `@soundor/vitest`, which `vitest.config.ts`
  imports. A test project that excludes it adds `"@soundor/vitest"` to
  `compilerOptions.types`.
