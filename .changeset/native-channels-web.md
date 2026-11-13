---
'@soundor/web-runtime': minor
---

Native channels on the Web: the generated contract exports `channels`, a `publish()` per declared channel for the project's `runtimes/web` code (`channels.spectrum.publish(values)`, an AnalyserNode read every frame). Each value is checked, a buffer copied, and one longer than its `maxLength` refused; the plugin UI receives the newest at the next animation frame, so a hidden page keeps one value per channel. The manifest lists the channels.
