---
title: useEditorSize
description: The editor's own size and whether it can be resized, re-rendering the component when the user, the DAW or the page resizes it.
---

```ts
function useEditorSize(): EditorSize;

interface EditorSize {
  readonly width: number; // the editor's logical pixels, whole
  readonly height: number;
  readonly resizable: boolean; // whether requestEditorSize() can ask for another
}
```

`useEditorSize()` returns the size of the editor the view is shown in (the
plugin's window in a DAW or the Standalone, the plugin viewport on the web
host's page) and re-renders the component when it changes, whoever resized
it: the user, the DAW, the page, or a
[`requestEditorSize()`](/docs/api/ui#asking-for-a-size). It does not
re-render for an unchanged size, and it does not poll.

It is for what concerns the editor itself, most of all a
[resize grip](/docs/api/ui#a-resize-grip) that hides where `resizable` is
false:

```tsx
import { useEditorSize } from '@soundor/react';

function ResizeGrip() {
  const editor = useEditorSize();
  if (!editor.resizable) return null;
  return <Grip width={editor.width} height={editor.height} />;
}
```

## The editor is not the view

In an editor that lays out again, the editor's size is the view's. In one that
scales, the view is drawn at a zoom, so the editor is the view's size times
that zoom, bands included with `fit: 'contain'`. Lay out with
[`useViewSize()`](/docs/hooks/use-view-size) and ask for sizes with
`useEditorSize()`; a layout that only grows and shrinks needs flexbox, not
either.

## In each runtime

- **JUCE and Web:** as above; before the host shows the editor, `width` and
  `height` are 0, and `resizable` is false for a fixed editor and in the web
  host's `?embed`, whose page owns the size.
- **Tests:** the editor's size from the project's config (800×600 without
  one); [`testEditor.resize()`](/docs/testing/test-editor) changes it.

It reads [`soundor:ui`](/docs/api/ui#the-editors-size)'s `editorSize()` and
`subscribeEditorSize()`, which code outside React can use directly.
