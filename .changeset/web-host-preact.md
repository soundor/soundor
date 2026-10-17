---
'@soundor/web-runtime': patch
---

The Web host's UI is written in Preact (about 5 KB gzipped), independent of the plugin's own React. The runtime's Vite plugin optimizes Preact up front, so it loads once.
