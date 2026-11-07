---
'@soundor/environment': minor
'@soundor/web-runtime': minor
'@soundor/test-runtime': minor
'vitest-environment-soundor': minor
'@soundor/react': patch
---

`ResizeObserver` is a global that observes nodes, as on the Web: its callback is told after a frame's `requestAnimationFrame` callbacks and layout of each node whose content, border or device-pixel content box changed size. In the web runtime it takes the browser's place for nodes, and passes DOM elements on to it. The simulated runtime's observes nodes and never calls back, as nothing is laid out there. `useScrollbar` no longer reads sizes every frame: it is told of changes by a `ResizeObserver` and by `scroll` events.
