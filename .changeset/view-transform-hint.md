---
'@soundor/engine': minor
'@soundor/environment': minor
'@soundor/test-runtime': minor
---

Add the opt-in `willChange: 'transform'` style. The web renderer forwards the hint to CSS. The native renderer can reuse a cached subtree when only that view's transform changes.
