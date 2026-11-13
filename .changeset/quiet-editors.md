---
'@soundor/environment': minor
'@soundor/test-runtime': minor
'@soundor/testing-library': minor
'@soundor/engine': minor
'@soundor/juce-runtime': minor
'@soundor/web-runtime': minor
---

Add boolean `soundor:ui` isVisible()/subscribeVisibility() and isFocused()/subscribeFocus() APIs so plugins can react to editor visibility and keyboard focus across runtimes. Add test runtime setters and Testing Library editor helpers. The analyzer example pauses its UI subscriptions while hidden.
