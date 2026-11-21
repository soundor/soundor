---
'@soundor/engine': minor
'@soundor/environment': minor
'@soundor/react': minor
'@soundor/test-runtime': minor
'@soundor/testing-library': minor
---

Honor `accessibilityState.disabled` for pointer activation, wheel, keyboard and focus across runtimes. Disabled subtrees still receive hover, but lose focus and cancel active presses. Use `accessibilityState.readOnly` to describe a read-only value without blocking input such as a “Copy value” context menu.
