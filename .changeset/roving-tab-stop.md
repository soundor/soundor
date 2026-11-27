---
'@soundor/engine': patch
'@soundor/environment': patch
'@soundor/react': patch
'@soundor/test-runtime': patch
---

A focusable node can leave the Tab order and stay focusable, for roving focus in composite widgets (lists, radio groups, toolbars): `tabStop={false}` on a `View` or `Pressable`, and `node.tabStop` in `soundor:ui`. A press, `focus()` and assistive technology still focus it, it still receives keys and has `focusVisible`, and its semantics are unchanged; Tab and Shift+Tab skip it in every runtime and in a `FocusScope`, and from it go on to the next Tab stop in tree order. `FocusScope`'s `autoFocus` focuses the first Tab stop.
