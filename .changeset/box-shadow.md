---
'@soundor/environment': minor
'@soundor/react': minor
'@soundor/test-runtime': minor
---

Box shadows: `soundor:ui`'s `Style` declares `boxShadow`, a list of `BoxShadow` (`offsetX`, `offsetY`, `blur`, `spread`, `color`, `inset`), as CSS's `box-shadow`. `@soundor/react` nodes take it in `style` and compare it by value, so re-rendering the same shadows in a new array sets no style; the test runtime keeps it.
