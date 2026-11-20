---
'@soundor/vst3-runtime': patch
---

A change to persistent state now tells the host its project is modified: VST3's `setDirty`. A host's restore does not. The VST3 runtime also no longer declares its component distributable, since the component and its controller must share a process. After a restore it tells the host to read the parameters back. When the UI, the controller or History selects a factory preset, the host's program selector now follows.
