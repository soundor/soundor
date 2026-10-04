---
'@soundor/web-runtime': minor
---

The Web host implements `soundor:ui`, `soundor:storage` and `soundor:fs`, so plugin UIs written with `@soundor/react` run in the browser unchanged.

- `soundor:ui` draws with DOM elements in the host's plugin viewport; there is no ReactDOM. A stylesheet gives the DOM Yoga's defaults (flex columns that do not shrink, border-box sizes, no inherited text style), and styles are validated with the JUCE runtime's messages.
- All five node types, the tree rules, `layout` and `getBoundingClientRect()` (in view coordinates, whatever the viewport's scale), focus and selection, scrolling, `pressable`, the clipboard (with an in-page fallback), `focusedNode()` and `viewSize()`.
- Events capture and bubble along the Soundor tree, with UiNode targets. Input follows the JUCE runtime's rules: implicit pointer capture, hover enter and leave along the tree, a click to the deepest node holding both press and release, focus on press, Tab cycling, and the wheel scrolling the nearest scroll view. Text inputs edit natively and report `beforeinput`, `input` and `change`. All four `pointerEvents` modes are honored.
- `soundor:storage` and `soundor:fs` keep their data in IndexedDB, one database per `plugin.id`, so plugins on one site never share data. `soundor:fs` is a private file tree: relative paths only, and the JUCE runtime's errors. Each write is atomic.
- A failed Vite build now reports Vite's error instead of only the phase that failed.
