---
'@soundor/juce-runtime': patch
---

On Linux, the default cursor over a plugin's view is now the cursor theme's arrow rather than whatever the host's window shows: JUCE's normal cursor is no cursor of the view's own on X11, so a cursor the host left on its window (Ardour's resize cursor after resizing it) stayed over the plugin once the UI's own cursor went back to `default`.
