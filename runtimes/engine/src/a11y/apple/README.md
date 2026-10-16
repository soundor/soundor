# Soundor's Apple accessibility bridge

On macOS, VoiceOver perceives a Soundor view through virtual
`NSAccessibilityElement`s that Soundor creates from its own semantic tree
(`a11y::SurfaceSemantics`). There is one element per semantic element, not one
`NSView` per node. The Skia surface stays a single custom-drawn view. AccessKit's
Apple adapters and JUCE's `AccessibilityHandler` are not involved.

- [Guide and reference](https://github.com/soundor/soundor/blob/main/docs/apple-accessibility.md)
- [All documentation](https://github.com/soundor/soundor/blob/main/docs/README.md)
- [Architecture](https://github.com/soundor/soundor/blob/main/docs/architecture.md)
