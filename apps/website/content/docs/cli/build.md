---
title: 'soundor build'
description: 'Builds the plugin for release: one production UI bundle, then every runtime, or one.'
---

```sh
soundor build [runtime] [--config <path>]
```

`build` makes what you ship: it generates the contract for production,
bundles the UI once (minified, tree-shaken), then runs each runtime's build
with it.

| Argument / option | What it does                                                 |
| ----------------- | ------------------------------------------------------------ |
| `runtime`         | Only this runtime: `soundor build web`. All of them without. |
| `--config <path>` | The config to use, instead of finding `soundor.config.ts`.   |

## What each runtime makes

- **JUCE:** a Release plugin (VST3, AU, Standalone: the formats the runtime
  is given) with the UI compiled to Hermes bytecode and no DevTools bridge,
  in `.soundor/dist/juce/`. It links the prebuilt engine for the installed
  engine version ([Soundor Engine](/docs/engine)). On macOS it signs as its
  last step ([signing](/docs/juce-runtime#signing-and-distributing-on-macos)).
- **Web:** a static site in `.soundor/dist/web/`, with relative URLs, so it
  works from any path and in an iframe ([web runtime](/docs/web-runtime)).

## Good to know

- **A runtime that fails** does not stop the others: `build` builds each one,
  then reports every failure, and exits with an error if any failed.
- **One bundle for all:** every runtime gets the same production UI, so a
  plugin behaves the same in each.
- **In CI,** run [`soundor doctor`](/docs/cli/doctor) first: it says what is
  missing before a long native build fails on it.
