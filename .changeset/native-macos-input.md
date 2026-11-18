---
'@soundor/engine': patch
'@soundor/juce-runtime': patch
---

Read macOS input directly through an AppKit child view in the prebuilt engine, including fractional two-axis trackpad scrolling, native momentum, keyboard and committed IME text. Reuse accessibility's randomized Objective-C class isolation and lifetime policy, and detach native input safely when an editor closes.
