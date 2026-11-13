---
'@soundor/core': minor
'@soundor/test-runtime': minor
'@soundor/vitest': minor
'@soundor/testing-library': minor
---

Native events: `native.events` declares what the plugin's native code tells its UI, each event with the fields of its value (`presetLoaded: { path: 'string', preset: 'Preset?' }`, `ready: {}`), of the same types as arguments. `soundor:native` exports them as `events`: `events.presetLoaded.subscribe(({ path, preset }) => …)` returns a function that unsubscribes. Subscribers run on the UI thread after the publishing call returns, in the order published, and receive only events published after they subscribed; a UI holds at most 1024 undelivered events and drops newer ones. A method can no longer be called `events`. In tests, `emitNative(name, value)` from `@soundor/testing-library` publishes one to the UI's subscribers.
