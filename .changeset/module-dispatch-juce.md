---
'@soundor/juce-runtime': patch
---

State and History notifications are delivered inside the runtime's tick (`dispatchModules`), right after parameter changes and under the same time limit, instead of before it with a limit per callback. A state change is converted to JavaScript only when the field has a subscriber.
