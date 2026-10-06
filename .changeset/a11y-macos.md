---
'@soundor/juce-runtime': minor
---

VoiceOver reads the plugin view on macOS through Soundor's own bridge: virtual `NSAccessibilityElement`s built from Soundor's semantic tree, with no view per control and neither AccessKit nor JUCE's accessibility. VoiceOver's press, increment, decrement, cancel, set value and custom actions reach plugin code as accessibility actions on the UI thread. Value, title, layout, focus and destroyed-element changes are announced. Frames follow the window.

It is safe in a plugin host. The single element class is created at runtime under a random name that carries the plugin's ABI namespace. Nothing is swizzled and no existing class is modified. Elements reach their bridge only by token. Once the class exists the binary stays loaded, so nothing VoiceOver keeps can call into unloaded code. The bridge activates only while VoiceOver or Switch Control is on.
