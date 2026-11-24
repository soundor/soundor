---
'@soundor/engine': patch
'@soundor/react': patch
'@soundor/test-runtime': patch
---

Handle semantic context menu requests with `onContextMenu`, including Shift+F10, the Context Menu key, and native accessibility actions. Keyboard and accessibility requests anchor to the target's bounds, and wrapper handlers work without replacing a control's primary role or actions.
