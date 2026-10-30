---
'@soundor/web-runtime': patch
---

Selecting text in a text input with the mouse (dragging, double-clicking) works in Firefox: a press in an input no longer captures the pointer for the view, which kept Firefox's own text selection from getting the moves. The press still goes to the input, and a release outside the view still ends it.
