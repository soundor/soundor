---
'@soundor/driver': minor
'@soundor/vitest-e2e': minor
'@soundor/juce-runtime': minor
---

Narrow the `@soundor/vst3-host` peer dependency to a caret range matching the host release used for development, instead of accepting every pre-1.0 minor. This supports patches in the current minor without claiming compatibility with future breaking host API changes. The host remains optional for the Driver and JUCE runtime and required for Vitest E2E.
