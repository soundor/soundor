---
'@soundor/juce-runtime': minor
'@soundor/vst3-host': patch
---

On Linux, every plugin build and every build of the VST3 host links the C++ runtime statically, and a plugin's is hidden from other plugins, so a plugin no longer needs a `libstdc++` as new as its build machine's, and needs neither `libatomic` nor, as a VST3, `libasound`. A build machine now needs the compiler's static C++ library (Fedora, RHEL: `libstdc++-static`): without it, a build stops first and says what to install, and `soundor doctor` reports it. `soundor build` prints the glibc a release needs, and `soundor doctor` warns when the machine's is newer than the 2.39 of Ubuntu 24.04, as a release built there may not load on older systems.
