---
title: 'soundor build'
description: 'Builds the plugin for release: one production UI bundle, then every runtime, or one.'
---

```sh
soundor build [runtime] [--config <path>] [--out <dir>]
soundor build <runtime> --debug [--config <path>] [--out <dir>]
```

`build` makes what you ship: it generates the contract for production,
bundles the UI once (minified, tree-shaken), then runs each runtime's build
with it.

| Argument / option | What it does                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `runtime`         | Only this runtime: `soundor build web`. All of them without.                                      |
| `--config <path>` | The config to use, instead of finding `soundor.config.ts`.                                        |
| `--out <dir>`     | Where the output goes, from the current directory, instead of under `.soundor/`. Needs a runtime. |
| `--debug`         | A [debug build](#debug-builds), for tests. Needs a runtime with DevTools.                         |

## What each runtime makes

- **JUCE:** a Release plugin (VST3, AU, Standalone: the formats the runtime
  is given) with the UI compiled to Hermes bytecode and no DevTools bridge,
  in `.soundor/dist/juce/`. It links the prebuilt engine for the installed
  engine version ([Soundor Engine](/docs/engine)). On macOS it signs as its
  last step ([signing](/docs/juce-runtime#signing-and-distributing-on-macos)).
- **Web:** a static site in `.soundor/dist/web/`, with relative URLs, so it
  works from any path and in an iframe ([web runtime](/docs/web-runtime)).

## Debug builds

`soundor build juce --debug` makes a Debug plugin with DevTools for
[end-to-end tests](/docs/testing/e2e) and the [Driver](/docs/driver/vst3), then
exits. **Never ship it.** Its output is apart from releases, in
`.soundor/debug/juce/`, or in `--out`, with each format directly inside:

```sh
soundor build juce --debug --out e2e/build
# e2e/build/VST3/My Plugin.vst3
```

Its UI is embedded, so the bundle stands alone. It has build folders of its own,
so it can run during a [`soundor dev`](/docs/cli/dev) without disturbing it. It
is incremental: with nothing changed, it does little.

`--out` replaces what the build makes there and leaves everything else, so a
format or a plugin you have since removed stays until you delete it.

## Good to know

- **A runtime that fails** does not stop the others: `build` builds each one,
  then reports every failure, and exits with an error if any failed.
- **One bundle for all:** every runtime gets the same production UI, so a
  plugin behaves the same in each.
- **In CI,** run [`soundor doctor`](/docs/cli/doctor) first: it says what is
  missing before a long native build fails on it.
