---
'@soundor/juce-runtime': minor
---

Build ANGLE (OpenGL ES 3 on Metal, Direct3D 11 and Vulkan) from a pinned revision, once per machine and cached like Skia, as the foundation for GPU composition and WebGL. gn decides what to compile; Soundor compiles it with the plugin's own toolchain, hidden and statically linked, so no EGL or GLES symbol leaves a plugin. Nothing renders with it yet. `soundor doctor` names ANGLE among what git, Python 3 and ninja are needed for, and `-DSOUNDOR_ENABLE_GPU=OFF` builds without it.
