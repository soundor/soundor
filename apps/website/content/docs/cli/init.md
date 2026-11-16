---
title: 'soundor init'
description: 'Creates the Rust crate and initializes runtimes that need host files.'
---

```sh
soundor init [runtime] [--config <path>]
```

`init` creates the project's Rust crate and calls each selected runtime's
initialization phase. JUCE and Web manage their own hosts and write no host
files; neither needs runtime initialization. Other runtimes may create
user-owned files in `runtimes/<id>/`.

Every plugin gets `native/src/lib.rs` (module declarations and
`soundor::export!(PluginProcessor, PluginController)`), `controller.rs`
(the controller and its stores), and `processor.rs` (audio and MIDI
processing). The controller is required even without native methods;
`NativeMethods` then has a generated blanket implementation. Configured
methods get compiling stubs in `controller.rs`.

## Good to know

- **It never overwrites.** A file that exists is kept, so running `init`
  again only adds what is missing: a runtime added to the config, a file you
  deleted to get it back as new.
- **It does not upgrade your files.** What every plugin needs lives in the
  generated framework ([`gen`](/docs/cli/gen)) or the runtime package, so an
  update of Soundor reaches existing projects without touching your code.
- **Adding a runtime:** install its package, add its factory to `runtimes`
  in the config, then `soundor init <id>` if it needs host files. JUCE and Web do not.

```sh
pnpm add @soundor/web-runtime
# soundor.config.ts: runtimes: [juceRuntime({ … }), webRuntime()]
pnpm exec soundor dev web
```

A new project from [`create-soundor-app`](/docs/cli/create-soundor-app) has
been through `init` already.
