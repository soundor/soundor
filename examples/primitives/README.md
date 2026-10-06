# primitives

A tour of `@soundor/react`'s UI primitives, one card each, in a plugin built
for both runtimes. The audio is `basic`'s gain; the UI is the point.

```text
soundor.config.ts   identity, the `gain` parameter, both runtimes
src/main.tsx        the tour (@soundor/react)
runtimes/juce/      JUCE (C++): applies `gain`
runtimes/web/       Web (TypeScript): applies `gain` with a GainNode
```

| Card                | Shows                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| Coordinates         | `locationX`/`locationY` (in the target) next to `pageX`/`pageY` (in the view)                            |
| zIndex              | Raising one of two overlapping siblings, for drawing and hit testing                                     |
| Context menu        | `onContextMenu` and a `Portal` menu at the pointer                                                       |
| Long press, tooltip | `onLongPress`, the `focused` state, a tooltip placed with `getBoundingClientRect()`                      |
| Dropdown            | Menus opened from a clipped `ScrollView`, shown in the overlay layer                                     |
| Portal.Host         | Content rendered into a custom host, clipped where the host is                                           |
| Modal               | A dimmed, focus-trapping dialog with a dropdown in it and a nested dialog; Escape or the backdrop closes |
| FocusScope          | Tab trapped in two fields, and released                                                                  |

## In the browser

```sh
pnpm dev:web     # soundor dev web: the host at http://localhost:5173
pnpm build:web   # soundor build web: a static site in .soundor/dist/web
```

## As a JUCE plugin

```sh
pnpm exec soundor dev juce     # a debug build, the Standalone launched
pnpm exec soundor build juce   # VST3 and Standalone in .soundor/dist/juce
```

JUCE must be installed (see `soundor doctor`).
