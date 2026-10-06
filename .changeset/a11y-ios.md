---
'@soundor/juce-runtime': patch
---

The native runtime gains Soundor's iOS VoiceOver bridge: virtual `UIAccessibilityElement`s from the semantic tree. Double tap, swipe up and down on adjustables (with the new value announced), the escape gesture and custom actions all reach plugin code. Containers are semantic groups, and modals post screen changes. It shares the macOS bridge's plugin-safety machinery (runtime class, tokens, pinning). Soundor has no iOS plugin build yet, so CI compiles the bridge for the simulator, and its attachment contract and device checklist are documented.
