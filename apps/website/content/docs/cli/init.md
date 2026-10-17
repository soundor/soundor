---
title: 'soundor init'
description: "Writes the runtimes' host projects into runtimes/<id>/, once; they are yours to edit."
---

```sh
soundor init [runtime] [--config <path>]
```

`init` writes each configured runtime's host project into `runtimes/<id>/`:
the files you own and edit. The JUCE runtime writes its CMake project, plugin
processor and editor; the web runtime its page, Vite config, `audio.ts` and
`native.ts`.

| Argument / option | What it does                                                      |
| ----------------- | ----------------------------------------------------------------- |
| `runtime`         | Only this runtime (its `id`: `juce`, `web`). All of them without. |
| `--config <path>` | The config to use, instead of finding `soundor.config.ts`.        |

## Good to know

- **It never overwrites.** A file that exists is kept, so running `init`
  again only adds what is missing: a runtime added to the config, a file you
  deleted to get it back as new.
- **It does not upgrade your files.** What every plugin needs lives in the
  generated framework ([`gen`](/docs/cli/gen)) or the runtime package, so an
  update of Soundor reaches existing projects without touching your code.
- **Adding a runtime:** install its package, add its factory to `runtimes`
  in the config, then `soundor init <id>`.

```sh
pnpm add @soundor/web-runtime
# soundor.config.ts: runtimes: [juceRuntime({ … }), webRuntime()]
pnpm exec soundor init web
```

A new project from [`create-soundor-app`](/docs/cli/create-soundor-app) has
been through `init` already.
