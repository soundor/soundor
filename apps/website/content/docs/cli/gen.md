---
title: 'soundor gen'
description: "Regenerates the types and the runtimes' frameworks from soundor.config.ts."
---

```sh
soundor gen [--check] [--config <path>]
```

`gen` turns `soundor.config.ts` into the files that make the contract real,
in `.soundor/generated/`:

- the TypeScript declarations of the `soundor:*` modules, typed from the
  config (`parameters.gain` exists because the config declares it), image
  imports, and the Web globals the runtimes provide;
- each runtime's own framework: for JUCE, its CMake integration, processor
  and editor bases, and the C++ native API with its bindings; for the web,
  a manifest with the Rust controller contract and event/stream publishers;
- the Rust SDK, `rust/soundor`, with the config's contract in `src/plugin.rs`:
  the processor's parameters, layouts, streams, state and resources, and the
  controller's `NativeMethods` trait, native types, and the controller
  descriptor the runtime checks it against.

| Option            | What it does                                                      |
| ----------------- | ----------------------------------------------------------------- |
| `--check`         | Writes nothing; fails if a generated file is out of date. For CI. |
| `--config <path>` | The config to use, instead of finding `soundor.config.ts`.        |

## Good to know

- **You rarely run it:** [`dev`](/docs/cli/dev) and [`build`](/docs/cli/build)
  generate first. Run it after editing the config, so your editor sees the new
  types, or when a test or a typecheck runs without them.
- **Never edit `.soundor/generated/`**: the next `gen` replaces it. Change the
  config, or (for what every project gets) the runtime package.
- **It is deterministic:** the same config gives the same files, so
  `soundor gen --check` in CI catches a config changed without regenerating,
  and generated files can be committed or ignored as you prefer.
- **A typecheck script** runs it first:
  `"typecheck": "soundor gen && tsc -b"`.

## Rust starter files

`gen` also creates a Rust starter crate under `native/` and a
`rust-toolchain.toml` file when `native/Cargo.toml` is absent. Existing files
are preserved. If the manifest already exists, generation leaves the crate
and its layout untouched, including missing or intentionally removed tests. Development and builds run generation automatically;
new projects need no separate initialization command or runtime host directory.

`gen --check` compares only the derived output under `.soundor/` and never
creates or updates user-owned starter files.
