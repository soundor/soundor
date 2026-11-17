---
title: useEditorVisibility
description: Whether the editor is shown, re-rendering the component when it is hidden or shown, to pause work nobody can see.
---

```ts
function useEditorVisibility(): boolean;
```

`useEditorVisibility()` is `true` while the editor is visible and re-renders
the component when that changes. Use it to stop optional work, such as a
spectrum, an animation or a stream of updates, while nobody can see it:

```tsx
import { useEditorVisibility } from '@soundor/react';

function Analyzer() {
  const visible = useEditorVisibility();
  return visible ? <Spectrum /> : null;
}
```

Unmounting `Spectrum` cleans up its subscriptions and animation loops; showing
it again mounts it and reads the latest data. See the
[analyzer example](/docs/examples/analyzer).

- **It is not keyboard focus.** A visible editor can be unfocused (another
  window has the focus); see [`useEditorFocus`](/docs/hooks/use-editor-focus).
- **It does not stop anything by itself:** audio processing, timers,
  animations and native streams keep running. Stop the work in the component
  the hook gates, or in an effect that depends on it, and resume it when
  visible.
- **It re-renders once per change**, with the new value, never for an unchanged
  one.

## In each runtime

- **Web:** the document's page visibility, including a background tab.
- **JUCE:** whether the editor is showing, sampled before each UI tick.
  Losing keyboard focus does not hide an editor; occlusion by another window
  and scrolling offscreen are not detected. A native editor that closes
  destroys its JavaScript context, and reopening creates a fresh one starting
  from the current value: there is no final hidden notification at teardown.
- **Tests:** visible at the start; [`testEditor.setVisible()`](/docs/testing/test-editor)
  changes it, and the React entry commits the update synchronously.

It reads [`soundor:ui`](/docs/api/ui#focus-and-visibility)'s `isVisible()` and
`subscribeVisibility()`, which code outside React can use directly.
