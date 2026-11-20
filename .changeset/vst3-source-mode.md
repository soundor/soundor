---
'@soundor/vst3-runtime': patch
'@soundor/engine': patch
---

Source mode for the VST3 runtime: `vst3Runtime({ engine: { mode: 'source' } })` builds the engine and the VST3 adapter on the machine with CMake (Ninja, or Visual Studio on Windows, and a C++20 compiler) instead of downloading their releases. Both builds go into the Soundor cache once per package version (`engine-source/`, `vst3-adapter-source/`), and `soundor doctor` checks CMake and Ninja in this mode. The package now carries the adapter's sources (`native/`). `engine({ mode: 'source' })` builds an installed package's native engine, and in the other modes an installed package still never compiles. `@soundor/engine/archives` also exports `withLock`.

`soundor doctor` on Windows now also checks that the linker's library paths have the Windows SDK and the static C runtimes (`kernel32.lib`, `libucrt.lib`, `libcmt.lib`). Visual Studio can have the C++ tools without an SDK, so this tells you what to add in the Visual Studio Installer. A Windows build gives the same message before linking, instead of `link.exe`'s "cannot open file 'kernel32.lib'".
