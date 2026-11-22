---
'@soundor/engine': minor
'@soundor/environment': minor
'@soundor/react': minor
'@soundor/test-runtime': minor
'@soundor/testing-library': minor
'@soundor/web-runtime': minor
---

Add `KeyboardEvent.code`, the physical key (`KeyS`, `Digit1`), in every runtime, so shortcuts such as Option+S on macOS or Shift+1 match whatever the key types. Natively it comes from the scan code, virtual key code or X11 keycode; Soundor Driver's keys and `user.keyboard` have the US key that types them.

Add `accessibilityKeyShortcuts` (`accessibility.keyShortcuts`), the shortcuts that act on an element as `aria-keyshortcuts` writes them: `aria-keyshortcuts` on the web, UI Automation's `AcceleratorKey`, AT-SPI's `keyshortcuts` attribute, and the help text on macOS and iOS.

Add `announce(message, { priority })` to `soundor:ui`, for a screen reader to speak what an action did: an ARIA live region on the web, UI Automation notification events, AT-SPI `object:announcement`, and AppKit's and UIKit's announcement notifications. `testView.announcements()` lists them in tests.
