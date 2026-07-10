---
'@soundor/juce-runtime': minor
---

Scaffold a working gain: the generated processor now applies the config's `gain` parameter (ramped) and overrides `isBusesLayoutSupported` so it works in DAWs like Reaper, not just standalone.
