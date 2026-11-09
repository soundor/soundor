---
'@soundor/environment': minor
'@soundor/react': minor
'@soundor/test-runtime': minor
'@soundor/testing-library': minor
'@soundor/driver': minor
'@soundor/devtools-protocol': minor
'@soundor/devtools-server': minor
'soundor': minor
---

Double clicks: `soundor:ui` declares the `dblclick` event and `PointerEvent.detail` (which click of a series a `click` is, as the platform counts them), and `@soundor/react` nodes take `onDoubleClick` and `onDoubleClickCapture`. The test runtime counts a press as its `detail` says (1 by default) and fires `dblclick` after a second click; Testing Library adds `user.dblClick()` and `fireEvent.dblClick()`, and `user.pointer` presses take a `detail`. Soundor Driver adds `locator.dblclick()`, `pointer.dblclick()` and a `clickCount` option for `pointer.down()` and `pointer.click()` (`Input.dispatchPointer`'s `clickCount`), and `soundor driver dblclick`.
