---
'@soundor/vitest-e2e': minor
'@soundor/driver': minor
'@soundor/vst3-host': minor
---

Add `@soundor/vitest-e2e`: Vitest tests of a built VST3 plugin in the real host, with `launchPlugin()`, `launchHost()`, the `soundor({ vst3 })` plugin and the `toBeVisible`, `toBeHidden` and `toHaveText` matchers. `Vst3Plugin` from `@soundor/driver/vst3` gains locators that survive a reopened editor, `pointer`, `keyboard`, `screenshot()` and `parameter()`. `Vst3Host` gains `parameter(title)`.
