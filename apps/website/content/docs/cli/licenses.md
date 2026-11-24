---
title: 'soundor licenses'
description: "Lists the third-party notices each runtime's build ships, without building it."
---

```sh
soundor licenses [runtime] [--json] [--config <path>]
```

`licenses` lists what each runtime's build would ship in its `licenses/`
folder (see [Third-party notices](/docs/licenses)), without building the
plugin: every component, its version, its license, and where its notice comes
from.

| Option            | What it does                                                  |
| ----------------- | ------------------------------------------------------------- |
| `[runtime]`       | Only this runtime (`vst3`, `web`); all of them by default.    |
| `--json`          | Prints each runtime's `licenses.json`, plus unused overrides. |
| `--config <path>` | The config to use, instead of finding `soundor.config.ts`.    |

```text
web: 12 components (MIT 10, (MIT OR NCSA) AND MIT 1, MIT OR Apache-2.0 1)
  engine/emscripten  emscripten ((MIT OR NCSA) AND MIT)
  engine/engine  engine (MIT)
  engine/yoga  yoga (MIT)
  javascript/preact@11.2.0  preact 11.2.0 (MIT)
  javascript/react@19.3.1  react 19.3.1 (MIT)
  ...
  rust/std@1.92.0  std 1.92.0 (MIT OR Apache-2.0)
```

## How it works

It bundles the UI as a release build does (into `.soundor/ui/licenses`), so
the packages that tree shaking keeps are the ones listed. Then each runtime
reports the rest: the VST3 runtime prepares the engine and the adapter a
release links (downloaded once, as a build does), and the web runtime bundles
its host page in memory. Cargo resolves the Rust crates for each runtime's
target; nothing is compiled.

## Good to know

- **It fails like a build does** when a component has no license text, and
  names the [`licenses`](/docs/cli/config#licenses) config that fixes it.
- **Overrides that match nothing** are listed at the end of each runtime's
  report.
- **A third-party runtime** that does not report its notices is listed as
  such.
