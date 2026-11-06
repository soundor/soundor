---
'@soundor/vst3-host': patch
---

Add `prepareHost({ mode: 'published' })`, which uses the published executable or fails rather than building, and `selectHost()`, which reports whether a published executable matches this checkout. A CI artifact keeps working after an upload loses its file modes.
