---
'@soundor/engine': minor
'@soundor/environment': minor
'@soundor/react': minor
'@soundor/test-runtime': minor
---

Make `contextmenu` a semantic request that the engine recognizes on every view: a secondary click (Control-click on macOS), Shift+F10 or the Context Menu key on the focused node (the default of its `keydown`), a touch long press (the default of its `longpress`), and the new predefined `showContextMenu` accessibility action (the default of its `accessibilityaction`), presented as AXShowMenu, UI Automation's `ShowContextMenu`, AT-SPI's `popup` and a VoiceOver action. A listener never advertises the action: declare it in `accessibilityActions`. Long presses are now a `longpress` event on any view (`onLongPress` and `onLongPressCapture`), recognized once by the engine for views and `Pressable` alike. `Pressable`'s `onLongPress` now receives that `longpress` event (`pointerType` `''` for the accessibility action) rather than the `pointerdown` or `accessibilityaction` event. An uncanceled context menu key now goes on to the plugin's host.
