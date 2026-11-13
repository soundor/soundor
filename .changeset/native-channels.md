---
'@soundor/core': minor
'@soundor/config': minor
'@soundor/test-runtime': minor
'@soundor/vitest': minor
'@soundor/testing-library': minor
---

Native channels: `native.channels` declares values the plugin's native code keeps publishing and the UI shows the latest of, each one number (`peak: { type: 'float32' }`) or a buffer of up to `maxLength` numbers (`spectrum: { type: 'buffer<float32>', maxLength: 512 }`). `soundor:native` exports them as `channels`: `get()` is the latest value received (undefined before the first, the value published last when a UI opens), and `subscribe((value, sequence) => …)` hears of each newer one, at most once a frame, `sequence` counting the publications so a gap is how many were skipped. `get` and `subscribe` work unbound, so `useSyncExternalStore(channels.peak.subscribe, channels.peak.get)` works. A method can no longer be called `channels`. In tests, `publishChannel(name, value)` from `@soundor/testing-library` publishes a value.
