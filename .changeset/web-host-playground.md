---
'@soundor/web-runtime': minor
---

Playground mode: opened with `?playground=<script>`, a static build loads that script (from the page's own origin only) instead of the plugin UI, gives it the host's `soundor:*` modules, and lets it run UI code a page sends it. The Soundor website uses it to let readers edit an example's code. The host shell also gains `clearMessages()`.
