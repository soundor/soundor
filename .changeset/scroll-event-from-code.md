---
'@soundor/engine': patch
---

Scrolling from code (`scrollTo`, `scrollBy`, `scrollTop`) fires `scroll`, once on the next tick, as it does in a browser.
