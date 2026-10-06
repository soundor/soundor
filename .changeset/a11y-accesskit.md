---
'@soundor/juce-runtime': minor
---

Screen readers on Windows (UI Automation) and Linux x64 (AT-SPI) now read the plugin view, through AccessKit. It presents Soundor's own semantic tree; JUCE's accessibility is not involved. The generated editor attaches it to its peer's native view and keeps its geometry and focus up to date. AccessKit's requests (click, increment, decrement, set value, focus, custom actions) reach the view as accessibility actions on the UI thread.

AccessKit 0.23.1 comes from the official prebuilt release (pinned, SHA-256 verified, cached once per machine), so no Rust toolchain is needed. It is linked privately and none of its symbols is exported. Linux arm64 has no prebuilt library and builds without platform accessibility. The native core gains `a11y::createPlatformAccessibility()`: a framework-independent attachment that a future runtime (iPlug2) can use the same way.
