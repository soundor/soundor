---
title: useEditorFocus
description: Whether keyboard focus is within the editor, re-rendering the component when it enters or leaves.
---

```ts
function useEditorFocus(): boolean;
```

`useEditorFocus()` is `true` while keyboard focus is within the editor,
including its controls, and re-renders the component when focus enters or
leaves it.

```tsx
import { Text, useEditorFocus } from '@soundor/react';

function FocusHint() {
  const focused = useEditorFocus();
  return (
    <Text>{focused ? 'Arrow keys adjust the knob' : 'Click to focus'}</Text>
  );
}
```

- **Moving between controls inside the editor keeps it focused.** Moving to
  the browser's address bar, elsewhere in the DAW or another application
  loses focus without necessarily hiding the editor.
- **It is not visibility.** A shown editor can be unfocused, and a hidden one
  can keep its focus; see [`useEditorVisibility`](/docs/hooks/use-editor-visibility).
  Neither is audio processing: nothing here pauses it.
- **It is not which control has focus.** For one node's focus, use the
  `onFocus` and `onBlur` props or [`FocusScope`](/docs/components/focus-scope).

## In each runtime

- **Web:** `document.hasFocus()`.
- **JUCE:** `hasKeyboardFocus(true)`, sampled before each UI tick. A closing
  native editor destroys its context without a final notification.
- **Tests:** unfocused at the start; [`testEditor.setFocused()`](/docs/testing/test-editor)
  changes it. It does not clear the last focused control.

It reads [`soundor:ui`](/docs/api/ui#focus-and-visibility)'s `isFocused()` and
`subscribeFocus()`, which code outside React can use directly.
