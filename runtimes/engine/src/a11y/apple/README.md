# Soundor's Apple accessibility bridge

On macOS, VoiceOver perceives a Soundor view through virtual
`NSAccessibilityElement`s that Soundor creates from its own semantic tree
(`a11y::SurfaceSemantics`). There is one element per semantic element, not one
`NSView` per node. The Skia surface stays a single custom-drawn view. AccessKit's
Apple adapters and JUCE's `AccessibilityHandler` are not involved.

- [Guide and reference](https://soundor.dev/docs/contribute/apple-accessibility)
- [Documentation](https://soundor.dev/docs)
- [Architecture](https://soundor.dev/docs/architecture)
