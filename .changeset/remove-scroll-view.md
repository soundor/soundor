---
'@soundor/react': minor
---

Remove `ScrollView` and `ScrollViewProps`. Use `View` or `Animated.View` with `overflow: 'scroll'`, `overflowX: 'scroll'` or `overflowY: 'scroll'` in its style instead. Apply content styles to the view or an explicit child `View`; `contentContainerStyle` is no longer available. Scroll events, indicators, `useScrollbar` and the node's scrolling methods work with these views.

The scrolling guide and live example now live on the View documentation page.
