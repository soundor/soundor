---
'@soundor/engine': patch
---

DevTools captures (`Capture.screenshot`, the Driver's and vitest-e2e's `screenshot()`) show WebGL and other GPU canvases again while the GPU compositor runs. The compositor marks a canvas's image as shown, so a capture skipped reading it back and drew stale pixels; a capture now reads back every GPU canvas.
