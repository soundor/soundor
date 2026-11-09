---
'@soundor/engine': minor
---

Box shadows: `Style::boxShadow`, a list of `BoxShadow { offsetX, offsetY, blur, spread, color, inset }` read from `style.boxShadow` (each field optional and checked, a `TypeError` naming its path), drawn as CSS draws `box-shadow`: the first on top, outer ones outside the border box before the background, inset ones inside the padding box over it, blurred by Skia's Gaussian mask (sigma half the blur). What a node draws outside its box is now `Style::inkOverflow()`, per edge, for its outline and its outer shadows, and damage, promoted-canvas layers and animation groups count that far around it. Shadows are not laid out, not hit and not animated; `node.style` compares them by value, as it does `transform`, and the DevTools inspector shows them.
