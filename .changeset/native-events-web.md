---
'@soundor/web-runtime': minor
---

Native events on the Web: the generated contract exports `events`, one publisher per declared event, for `runtimes/web/src/native.ts` (`events.presetLoaded({ path })`). Each checks its value as the JUCE bindings do, and the plugin UI's subscribers receive it right after the publishing code returns, in order; the page holds at most 1024 undelivered events. The manifest lists the events.
