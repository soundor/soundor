---
title: 'testView'
description: 'Resizes the plugin view in a test, as a user resizing the editor does, and lists what it announced.'
---

```ts
testView.resize(size: {
  width?: number;
  height?: number;
  scale?: number;
  safeArea?: LayoutRect | null;
}): void;
```

Merges `size` (`width`, `height` in logical pixels, `scale`, and the
`safeArea`) into the simulated view's size and tells `soundor:ui`'s
`subscribeViewSize()` subscribers when it changed, so
[`useViewSize()`](/docs/hooks/use-view-size) re-renders. Nothing is laid
out at the size: a test sees which layout a component chooses, not where
its nodes end up.

```tsx
await render(<Controls />);
expect(screen.getByLabelText('Controls')).toBeDefined();

testView.resize({ width: 520 });
expect(screen.getByLabelText('Controls, stacked')).toBeDefined();
```

## Announcements

```ts
testView.announcements(): readonly {
  message: string;
  priority: 'polite' | 'assertive';
}[];
```

What the UI asked a screen reader to speak with `soundor:ui`'s
[`announce()`](/docs/primitives/accessibility#announcements), in order,
since the test began (an empty message is none). The arguments are checked
as the runtimes check them.

```tsx
await render(<PresetBar />);
await user.keyboard('{Control>}c{/Control}');
expect(testView.announcements()).toEqual([
  { message: 'Preset copied', priority: 'polite' },
]);
```

## Good to know

- **Each test starts at the project's editor size** (`editor.width` and
  `editor.height` in `soundor.config.ts`, 800×600 without them) at a scale
  of 1; `soundor({ runtime: { view: { width, height, scale } } })` sets
  another ([`soundor()`](/docs/testing/vitest)).
- **The safe area is the whole view** until a test sets one, as an editor
  with [`fit: 'cover'`](/docs/cli/config#limits-fit-and-keepaspectratio-windows-the-ui-was-not-made-for) has
  in a window of another shape; it stays as the view resizes, and `null`
  makes it the whole view again.
- **The editor's size is separate:** [`testEditor`](/docs/testing/test-editor)
  sets it. Resize both where the runtimes would.
- **An unchanged size tells nobody,** as in the runtimes.
- From `@soundor/testing-library/react`, it re-renders inside `act()`.
