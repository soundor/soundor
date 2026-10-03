---
'@soundor/config': minor
'@soundor/core': minor
'@soundor/juce-runtime': minor
'@soundor/runtime-sdk': minor
'create-soundor-app': minor
---

**Breaking:** the plugin's identity moves to a top-level `plugin: { id, name }`, `nativeMethods` is replaced by a typed `native` API, and the JUCE WebView UI is removed.

- `plugin.id` (reverse-DNS) and `plugin.name` are required. JUCE uses them as `BUNDLE_ID` and `PRODUCT_NAME`. `juceRuntime()` options are flattened to JUCE-only settings (`jucePath`, `formats`, `companyName`, `pluginCode`, `manufacturerCode`); the codes default to stable values derived from `plugin.id`.
- `native: { types, methods }` declares structs, enums, opaque handles and methods, including `async` ones. `soundor gen` emits `native.d.ts` (the `soundor:native` module), and the JUCE runtime generates a C++ `soundor::native::NativeApi` interface plus validated, zero-copy QuickJS bindings for it.
- The JUCE editor no longer hosts a `WebBrowserComponent`: there is no bridge manifest, native allowlist, embedded UI bundle or dev-server URL. `@soundor/juce-runtime/bridge` is removed. The editor is an empty plugin view until the native UI lands.
