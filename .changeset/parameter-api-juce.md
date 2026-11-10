---
'@soundor/juce-runtime': minor
---

Parameters run their compiled behavior as plain C++ (`SoundorParameters.cpp`), in a `JuceParameter`: hosts get the plugin's own mapping, steps and text, with the editor closed; manual parameters are not automatable and read-only ones are meters. The base processor has typed handles (`gainParameter.load()`, the declared C++ type; choice enums in `namespace choices`), and read-only parameters' `publish()`, lock-free on the audio thread.
