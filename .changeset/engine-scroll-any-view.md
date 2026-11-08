---
'@soundor/engine': minor
---

Scrolling is a view's style, not a node type: a view with `overflow: 'scroll'` scrolls, and `overflowX`/`overflowY` (`Style::overflowX`, `Style::overflowY`) scroll one axis. `NodeType::Scroll` and `createScrollView()` are gone; `Node::scrolls()` says whether a view scrolls. `Surface::scrollTo()` takes a `ScrollBehavior` (smooth scrolls move frame by frame in `deliverScrolls()`), `Surface::scrollIntoView()` aligns a node in each view around it that scrolls, and `scrollTo()` on a node that does not scroll does nothing instead of throwing. A view whose style stops scrolling an axis goes back to its start there.
