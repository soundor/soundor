---
'@soundor/web-runtime': patch
---

The wheel with Control, which is how a browser reports a trackpad's pinch, no longer scrolls a scroll view: the browser zooms the page as it does elsewhere, unless plugin code calls `preventDefault()` to zoom something of its own. Before, a pinch over the plugin scrolled its content and the page could not be zoomed from there.
