---
title: 'testEditor'
description: "Resizes the plugin's editor in a test, as a user or a DAW does."
---

```ts
testEditor.resize(size: { width?: number; height?: number; resizable?: boolean }): void;
testEditor.setVisible(visible: boolean): void;
testEditor.setFocused(focused: boolean): void;
testEditor.requests(): readonly { width: number; height: number }[];
```

`testEditor.resize()` merges `size` (whole logical pixels of the editor) into the simulated
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

`resizable` changes what `editorSize().resizable` says, as a page that owns
the editor's size would.

## Requests

The simulated editor takes
[`requestEditorSize()`](/docs/api/ui#asking-for-a-size) as the runtimes do:
it checks and rounds the size, holds it to the project's `editor` limits
(and, scaling, its aspect ratio) and returns that, and the simulated host
gives the editor
that size after the calling code, in a microtask, the latest request
winning. `testEditor.requests()` lists every size asked for, held to the
limits, whether the host gave it or not:

```tsx
await render(<ResizeGrip />);
const grip = screen.getByRole('button', { name: 'Resize the editor' });
fireEvent.pointerDown(grip, {
  button: 0,
  buttons: 1,
  screenX: 1000,
  screenY: 700,
});
fireEvent.pointerMove(grip, { buttons: 1, screenX: 1100, screenY: 750 });
await act(() => Promise.resolve()); // the host answers
expect(editorSize()).toMatchObject({ width: 900, height: 650 });
expect(testEditor.requests()).toEqual([{ width: 900, height: 650 }]);
```

`soundor({ runtime: { editor } })` sets the editor of a test without a
project config, or overrides the project's:

```ts
editor: {
  width?: number; height?: number; // the view's by default
  resizable?: boolean;             // whether requests are taken: false by default
  minWidth?: number; minHeight?: number; maxWidth?: number; maxHeight?: number; // 1 to Infinity
  aspectRatio?: { width: number; height: number } | null; // an editor that scales keeping it
  applyRequests?: boolean;         // false: a host that ignores requests
}
```

## Good to know

- **Each test starts with the editor at the view's size**, the project's
  editor size, resizable within its limits when the project's editor is;
  `soundor({ runtime: { editor } })` sets another
  ([`soundor()`](/docs/testing/vitest)).
- **Sizes are whole, non-negative numbers;** anything else throws a
  `RangeError`. A request's are checked as in the runtimes: a `TypeError`
  for a side that is not a number, a `RangeError` for one that is not finite.
  Finite requests, including zero and negative numbers, are rounded and
  clamped to the editor's limits.
- **Nothing is laid out:** a request resizes the editor, not the view.
- **Pointer events' `screenX`/`screenY`** are what a test passes, or its
  `clientX`/`clientY`.
- **An unchanged size tells nobody,** as in the runtimes.
- From `@soundor/testing-library/react`, it re-renders inside `act()`.

## Focus and visibility

`testEditor.setVisible(false)` simulates a hidden editor;
`testEditor.setFocused(true)` simulates keyboard focus entering the editor.
They drive `soundor:ui`'s `isVisible()` / `subscribeVisibility()` and
`isFocused()` / `subscribeFocus()`, notifying once per change. The editor starts
visible and unfocused. These are independent of the focused node and of each
other; hiding does not destroy the simulated runtime. Both helpers commit
React updates synchronously when imported from `@soundor/testing-library/react`.
