---
'@soundor/web-runtime': minor
---

Double clicks in the web runtime: a click's `detail` is the browser's own count (by the platform's double-click time), and the second click of a series is followed by a `dblclick`, as in the JUCE runtime. A real release's click waits for the browser's `click` right after it, and is a single click when none comes; the browser's own `dblclick` no longer leaves the view.
