---
title: 'testView'
description: 'Resizes the plugin view in a test, as a user resizing the editor does.'
---

```ts
testView.resize(size: Partial<ViewSize>): void;
```

Merges `size` (`width`, `height` in logical pixels, `scale`) into the
simulated view's size and tells `soundor:ui`'s `subscribeViewSize()`
subscribers when it changed, so
[`useViewSize()`](/docs/hooks/use-view-size) re-renders. Nothing is laid
out at the size: a test sees which layout a component chooses, not where
its nodes end up.

```tsx
await render(<Controls />);
expect(screen.getByLabelText('Controls')).toBeDefined();

testView.resize({ width: 520 });
expect(screen.getByLabelText('Controls, stacked')).toBeDefined();
```

## Good to know

- **Each test starts at the project's editor size** (`editor.width` and
  `editor.height` in `soundor.config.ts`, 800×600 without them) at a scale
  of 1; `soundor({ runtime: { view: { width, height, scale } } })` sets
  another ([`soundor()`](/docs/testing/vitest)).
- **An unchanged size tells nobody,** as in the runtimes.
- From `@soundor/testing-library/react`, it re-renders inside `act()`.
