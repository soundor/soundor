---
'@soundor/engine': patch
---

Normalize Windows line endings in generated includes, WebGL IDL, and embedded Markdown when calculating engine input fingerprints, so identical checkouts produce matching fingerprints across platforms.
