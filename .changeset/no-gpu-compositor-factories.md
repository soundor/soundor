---
'@soundor/engine': patch
---

Provide the public GPU compositor factories in no-GPU builds. They return null with a diagnostic so consumers, including the JUCE plugin editor, link successfully and select CPU rendering.
