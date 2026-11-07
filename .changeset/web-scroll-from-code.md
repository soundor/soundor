---
'@soundor/web-runtime': patch
---

Scrolling a scroll view from code (`scrollTo`, `scrollBy`, `scrollTop`, `scrollLeft`) now fires its `scroll` event in the web runtime too, once, on the browser's next frame, as in the JUCE runtime; dragging or pressing its scrollbar fires it at once, as the wheel does.
