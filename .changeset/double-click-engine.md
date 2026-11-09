---
'@soundor/engine': minor
---

Double clicks: a click's `detail` says which of a series it is, and the second click of a series is followed by a `dblclick` (`Event::Type::DoubleClick`) to the same node. The platform counts the presses: `PointerInput::clicks` on the first button's down, which the click carries as `Event::detail`. Every pointer event has `detail` in `soundor:ui` (0 but for `click` and `dblclick`). The DevTools `Input.dispatchPointer` command takes a `clickCount` for `down` and `click`, so synthetic input says its count rather than depending on timing.
