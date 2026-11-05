---
'@soundor/driver': minor
'@soundor/vst3-host': patch
---

Add `@soundor/driver/vst3`: `launch()` runs a Debug build of a Soundor plugin in the VST3 host, in a private DevTools session, and gives a Driver for its UI beside the host for its audio. `@soundor/vst3-host` is an optional peer, and `@soundor/devtools-server` is now a dependency of the Driver. In the host, a handler that a plugin unregisters from Linux's run loop is released at once rather than on a later turn, which crashed `recreate()` on JUCE plugins, whose handlers can be gone by then.
