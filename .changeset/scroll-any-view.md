---
'@soundor/react': minor
'@soundor/web-runtime': minor
'@soundor/test-runtime': minor
'@soundor/environment': minor
---

Any view scrolls when its style says so, an `Animated.View` too: `overflow: 'scroll'` scrolls, as in CSS, and `overflowX` and `overflowY` scroll one axis (they win over `overflow`). `ScrollView` is now a view with that style, its children in a content container, and it always scrolls; `scrollIndicators` and `onScroll` are props of every `View`. Nodes scroll smoothly with `scrollTo()`/`scrollBy()` and `behavior: 'smooth'`, and `scrollIntoView()` brings a node into view in every view around it that scrolls.

Breaking:

- `createScrollView()` and the `'scroll'` node type are gone: create a view with `overflow: 'scroll'`.
- `overflow: 'scroll'` on a view scrolls it; it used to only clip, as `'hidden'` still does.
- `scrollTo()` on a node that does not scroll does nothing, as in browsers, instead of throwing.
- `useScrollbar(ref)` returns `{ vertical, horizontal }`, a bar for each axis, and no longer takes `axis`: `useScrollbar(ref, { axis: 'horizontal' })` is `useScrollbar(ref).horizontal`.
