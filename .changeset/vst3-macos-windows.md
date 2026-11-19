---
'@soundor/vst3-runtime': minor
---

The VST3 runtime now builds plugins on macOS (Apple silicon or Intel, for macOS 12 or later) and on Windows x64, as well as on Linux. Each platform builds for itself. The editor is an NSView on macOS and a child HWND on Windows. On both, the editor and the Rust controller run on a timer of the host's UI thread. macOS bundles are signed as the last build step. Windows plugins link the static C runtime with MSVC's `link.exe`, which the build finds with `vswhere`. The package ships prebuilt adapters for all three platforms.
