---
'@soundor/engine': patch
---

On Linux, AccessKit's prebuilt library is stripped of its debug info when it is extracted. It took 39 of the library's 47 MB and added about 21 MB to every plugin: a Release plugin goes from about 50 MB to 29 MB, and the Linux prebuilt engines shrink by about 6 MB each. Building on Linux now needs `strip`, which comes with the compiler toolchain.
