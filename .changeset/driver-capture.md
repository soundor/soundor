---
'@soundor/driver': minor
'soundor': minor
'@soundor/devtools-protocol': minor
'@soundor/devtools-server': minor
'@soundor/devtools-client': minor
'@soundor/config': minor
'@soundor/engine': minor
'@soundor/juce-runtime': minor
---

Soundor Driver screenshots: the engine captures its view as it renders it, as PNG (`capture` capability, `Capture.screenshot`), and the JUCE bridge uploads it to the DevTools server as binary, which keeps it as a short-lived capture clients read with their session cookie (bounded in size, number and lifetime). `driver.screenshot()`, `locator.screenshot()` and `soundor driver screenshot <path>` save it; DevTools previews and downloads it. Locators gain `waitFor()` and `isVisible()`, and a missing debug ID lists the ones there are.
