---
'@soundor/vst3-host': patch
---

Keep the editor scale requested through `launchHost` or `openEditor` when the display reports a different scale. Editors opened without an explicit scale still follow the display, including after switching presentations.
