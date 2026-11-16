---
'soundor': minor
'create-soundor-app': minor
'@soundor/web-runtime': minor
'@soundor/engine': minor
---

Require every plugin to export its Rust processor and controller. Scaffold separate entry, controller and processor modules, including an empty controller when no native methods are configured.

Run the same generated Rust NativeMethods contract in browsers through WASM, with instance stores, wake-driven async execution, control-thread scheduling, host services and resource publication to the separate AudioWorklet processor. Remove production WebNativeApi implementations and the browser host's native option. Move those methods to Rust and regenerate/rebuild existing projects. The portable Send/Sync bounds remain; unblock is native-only, and browser futures execute cooperatively on the main thread.
