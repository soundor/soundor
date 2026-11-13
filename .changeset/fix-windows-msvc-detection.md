---
'@soundor/juce-runtime': patch
---

Let CMake's Visual Studio generator discover MSVC on Windows, so doctor, dev and build accept installations without a compiler on PATH. Doctor reports that compiler validation happens at configure time.
