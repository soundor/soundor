---
'@soundor/juce-runtime': minor
'@soundor/engine': patch
'@soundor/vst3-host': patch
---

A JUCE plugin now runs on macOS 12 or later by default, whatever macOS it is built on, where it used to require the macOS of the machine that built it. `juceRuntime({ macos: { deploymentTarget } })` asks for a newer minimum, and anything below the engine's 12.0 is refused. `soundor doctor` checks for the Metal tools a source build of the engine needs. A prebuilt macOS engine no longer lists a framework by its path inside the Xcode that built it. Source builds of the VST3 host target macOS 12 too, as its published executables do.
