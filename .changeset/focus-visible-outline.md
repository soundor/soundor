---
'@soundor/environment': minor
'@soundor/engine': minor
'@soundor/web-runtime': minor
'@soundor/test-runtime': minor
'@soundor/react': minor
---

Focus rings that show only for the keyboard, and outlines to draw them with. `node.focusVisible` (`soundor:ui`) is CSS's `:focus-visible`: focus a pointer press gave is not shown until a key is pressed (not a shortcut nor a modifier on its own), focus moved by Tab, assistive technology or code after a key is, and a text input's always is. Every runtime decides it by the same rules, the web runtime too rather than by the browser's. A `focusvisiblechange` event (React: `onFocusVisibleChange`) fires whenever it changes, `FocusEvent.focusVisible` says what it is, and `pressable()`'s state and React's `PressableState` have `focusVisible`. The new styles `outlineWidth`, `outlineColor` and `outlineOffset` draw a line around a node as CSS's `outline`: outside its border, following its corners, taking no room in layout and not hit, so a ring can appear without moving anything.
