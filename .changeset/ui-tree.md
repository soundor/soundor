---
'soundor': minor
'@soundor/config': minor
'@soundor/core': minor
'@soundor/juce-runtime': minor
'@soundor/runtime-sdk': minor
'create-soundor-app': minor
---

New `soundor:ui` module: the plugin view as a tree of nodes with flexbox layout and DOM-style input events.

- `root`, `createView()`, `createText()`: `UiNode`s are `EventTarget`s with `appendChild`/`insertBefore`/`removeChild`, a React Native–style `style` (flexbox, spacing shorthands, percentages, absolute positioning, gaps, `pointerEvents`, text properties), `layout` and `getBoundingClientRect()`.
- Layout by Yoga v3.2.1, pinned and built privately with hidden symbols.
- Normalized input: pointer capture, hover enter/leave, clicks, wheel, keyboard, text input and focus with Tab navigation. Delivered as `PointerEvent`, `WheelEvent`, `KeyboardEvent`, `FocusEvent` and `InputEvent`, which capture and bubble along the tree.
- `EventTarget` events now run capture, target and bubble phases when targets form a tree; `stopPropagation()` and `composedPath()` behave as on the Web.
- The JUCE editor sizes the view's surface and forwards mouse, wheel and keyboard input; unhandled keys and wheel input go on to the host.
- `soundor gen` emits `ui.d.ts` with the module's types.
