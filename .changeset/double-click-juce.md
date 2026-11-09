---
'@soundor/juce-runtime': minor
---

Double clicks in the JUCE runtime: presses report JUCE's click count (`MouseEvent::getNumberOfClicks()`), which makes `event.detail` and `dblclick`, and the editor gives JUCE the platform's double-click time when it opens (`backend::useDoubleClickTime()`): macOS's and Windows' setting, the XSETTINGS `Net/DoubleClickTime` on Linux (GNOME's and KDE's), else JUCE's 400 ms.
