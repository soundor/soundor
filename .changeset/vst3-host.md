---
'@soundor/vst3-host': minor
---

New package: a standalone VST3 host for tests and development. `launchHost()` starts a native host process that loads a `.vst3` bundle by path, headless or with the plugin's editor in a native window, and processes audio offline: buses and channel layouts, sample-accurate parameter changes, MIDI in and out, transport, latency and tail, state, reset and recreate. Its executables ship as platform packages for Linux x64, macOS (universal) and Windows x64, installed as exact-version optional dependencies.
