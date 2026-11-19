---
'soundor': minor
'@soundor/core': minor
'@soundor/engine': minor
'@soundor/juce-runtime': minor
'@soundor/vst3-runtime': minor
'@soundor/web-runtime': minor
---

Publish `native.events` from the Rust controller through typed `ctx.events` publishers in JUCE, VST3, and the browser. UI subscriptions still use `events.name.subscribe(callback)`.

JUCE projects that used the generated C++ `nativeEvents` publishers must move those calls into a Rust controller method or a scheduled controller callback. Regenerate and rebuild plugins with matching versions of the CLI and runtime for the updated controller contract.
