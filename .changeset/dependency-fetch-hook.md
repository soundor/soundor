---
'@soundor/engine': patch
---

Before building Skia, ANGLE or a Hermes flavor into Soundor's cache, the engine's CMake runs the program `SOUNDOR_DEPENDENCY_FETCH` names, if it is set, with the cache root and the install's path in it. The program either leaves the complete install there or nothing; if it fails, the configure stops instead of building. Soundor's CI uses it to fetch the builds its main branch published. Skia, ANGLE and Hermes are now always built without the compiler launcher the environment names (`CMAKE_<LANG>_COMPILER_LAUNCHER`), since an install is kept and shared.
