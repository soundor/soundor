---
title: 'soundor dev'
description: 'Develops with one runtime: builds once, then watches the UI and reloads it on every save.'
---

```sh
soundor dev <runtime> [--config <path>]
```

`dev` runs one runtime for development: `soundor dev juce` builds a debug
plugin and launches its Standalone, `soundor dev web` serves the plugin in
the browser. Then it rebuilds the UI on every save and reloads it in the
running plugin.

| Argument / option | What it does                                               |
| ----------------- | ---------------------------------------------------------- |
| `runtime`         | The runtime to develop with: `juce`, `web`. Required.      |
| `--config <path>` | The config to use, instead of finding `soundor.config.ts`. |

## Reloading

`dev` builds the plugin in debug mode once, then keeps rebuilding the UI
whenever a project file changes. The plugin loads the UI from
`.soundor/ui/development` instead of embedding it, and on every successful build
replaces its JavaScript runtime with a fresh one: timers, subscriptions, open
parameter gestures and pending work of the old UI all end. State lives in the
plugin (parameters) or in `soundor:storage`, so it survives a reload.

- A failed build is reported in the terminal; the plugin keeps running the last
  good build.
- The plugin's `console` output and uncaught errors appear in the terminal,
  whichever process the plugin runs in (a DAW or the Standalone), with stack
  frames mapped back to your TypeScript sources.
- Changes to `soundor.config.ts` or native code need a restart of `soundor dev`.

When the runtime is ready, `dev` prints a summary: the plugin, the DevTools URL
and what the runtime adds (the JUCE runtime's build output and Standalone, the
Web host's URL). In a terminal, the output of the native build is collapsed
into one progress line; all of it is kept in `.soundor/dev/build.log`, and a
failed build prints it. Type a key and enter for a shortcut:

| Key | Action                                                          |
| --- | --------------------------------------------------------------- |
| `h` | Show the shortcuts                                              |
| `u` | Show the summary again                                          |
| `o` | Open DevTools in the browser, signed in                         |
| `c` | Copy a signed-in DevTools link (it works once, within a minute) |
| `s` | JUCE: launch the Standalone again                               |
| `w` | Web: open the Web host in the browser                           |
| `q` | Quit (as Ctrl+C)                                                |

`c` uses the platform's clipboard command; over SSH, or without one, it asks
the terminal to copy the link (OSC 52), which most terminals support. Outside
a terminal (piped, or in CI) there are no shortcuts and the build output is
printed as is.

## Good to know

- **Keep state where it survives a reload:** in parameters (the host's) or
  [`soundor:storage`](/docs/api/storage). React state starts over on every
  reload, as it does when the editor is closed and opened again.
- **The web runtime** reloads the page when the UI's build changes; edits
  to its own host files follow Vite's updates.
- **[DevTools](/docs/cli/devtools)** inspect the running native UI: its node
  tree, animations and rendering.
