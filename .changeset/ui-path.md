---
'@soundor/juce-runtime': patch
'@soundor/react': patch
---

UI updates cost what changed. Assigning a style it already has does not reach native code. A change that only looks different (a color, opacity) is drawn again but not laid out, text is measured again only when its font changes, and reading a style natively looks up only the properties it has. A view drawing a single shape with opacity needs no offscreen layer, and others a layer only the size of their box: 500 animated cells went from 22 ms to under 1 ms of rendering. The React renderer compares styles with what it set, not through `node.style`, and re-binds listeners or recomputes accessibility only when those props change.
