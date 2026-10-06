---
'@soundor/react': minor
'@soundor/juce-runtime': patch
---

`Modal` with `onRequestClose` offers assistive technology's `escape` (VoiceOver's scrub), which asks the topmost modal to close as Escape does. Activating a `TextInput` through assistive technology starts editing it (keyboard focus). The README documents the accessibility architecture: the three trees, the backend matrix, framework independence and coordinates, with examples for a button, a toggle, an adjustable gain control, a text input and a modal. The `primitives` example gains an accessible knob.
