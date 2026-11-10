---
'@soundor/web-runtime': minor
---

Parameters run the behavior `gen` compiles to JavaScript (`parameters.js`) from the same expressions as the JUCE runtime's C++: mapping, steps, `format` and `parse`. The host's controls move through normalized positions and show formatted values and choice labels; read-only parameters are disabled there, and `setupAudio` receives `publish(parameter, value)` to set them.
