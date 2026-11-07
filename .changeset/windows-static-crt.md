---
'@soundor/juce-runtime': minor
'@soundor/engine': minor
---

Windows plugins now include the C runtime by default (`/MT`, and `/MTd` in Debug), so users need no Visual C++ Redistributable, and an older runtime loaded by a host cannot crash them. `juceRuntime({ windows: { crt: 'MD' } })` keeps the DLL runtime, for a library that only comes built that way. The engine builds Skia, ANGLE and Hermes for the runtime in use, and Windows has `debug-static` and `release-static` prebuilt archives beside `debug` and `release`. Prebuilt engines are now built with MSVC 19.44, so Visual Studio 2022 17.14 or newer can link them, and an older one stops with a message saying so. Skia builds with the project's MSVC on Windows, rather than the newest installed.
