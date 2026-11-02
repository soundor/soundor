---
title: 'testEditor'
description: "Resizes the plugin's editor in a test, as a user or a DAW does."
---

```ts
testEditor.resize(size: { width?: number; height?: number }): void;
```

Merges `size` (whole logical pixels of the editor) into the simulated
editor's size and tells `soundor:ui`'s `subscribeEditorSize()` subscribers
when it changed, so a component reading
[`editorSize()`](/docs/api/ui#the-editors-size) re-renders. Only the
editor: the view keeps its size, as in an editor that scales, so resize it
too with [`testView`](/docs/testing/test-view) where an editor lays out
again.

```tsx
function Zoom() {
  const editor = useSyncExternalStore(subscribeEditorSize, editorSize);
  const view = useViewSize();
  return <Text>{`${Math.round((editor.width / view.width) * 100)}%`}</Text>;
}

await render(<Zoom />);
expect(screen.getByText('100%')).toBeDefined();

testEditor.resize({ width: 1600, height: 1200 });
expect(screen.getByText('200%')).toBeDefined();
```

## Good to know

- **Each test starts with the editor at the view's size**, the project's
  editor size; `soundor({ runtime: { editor: { width, height } } })` sets
  another ([`soundor()`](/docs/testing/vitest)).
- **Sizes are whole, non-negative numbers;** anything else throws a
  `RangeError`.
- **An unchanged size tells nobody,** as in the runtimes.
- From `@soundor/testing-library/react`, it re-renders inside `act()`.
