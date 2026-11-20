---
title: 'Source and generated file ownership'
description: 'Separate user-owned Rust files from deterministic generated framework code.'
---

## Purpose

Users edit their Rust processor and controller. Soundor regenerates the
bindings and framework around them, so package and config updates preserve
user code. Both first-party runtimes keep their hosts inside their packages.

## Where the code is

`packages/cli/src/commands/gen.ts` orchestrates generation. The CLI's
`library/scaffold.ts` supplies a starter crate when `lib/Cargo.toml` is absent. Existing
crates keep their sources, tests, package names and layout unchanged. Core's `paths.ts`, `codegen.ts` and `generate.ts` define the
output paths, collection and writing of derived files.

## Ownership

| Location                            | Owner and lifetime                                                 |
| ----------------------------------- | ------------------------------------------------------------------ |
| `lib/`, `rust-toolchain.toml`       | User-owned; `gen` creates a crate only when its manifest is absent |
| `.soundor/generated/`               | Shared declarations and Rust SDK, regenerated from config          |
| `.soundor/generated/runtimes/<id>/` | Runtime codegen output, `ctx.paths.gen`                            |
| `.soundor/cache/<id>/`              | Runtime scratch/build data, `ctx.paths.cache`                      |
| `.soundor/dist/<id>/`               | Runtime build output, `ctx.paths.dist`                             |
| `.soundor/state/<id>/`              | Persistent runtime state, `ctx.paths.state`                        |
| `.soundor/ui/`                      | CLI-owned UI bundles and assets                                    |

Runtime `gen` hooks emit relative paths and contents through `ctx.codegen`.
The CLI writes them or compares them for `--check`. Check mode never writes,
including missing Rust starter files. Development and builds run generation
automatically. No runtime initialization hook or host scaffolding is needed.

## Invariants and tests

Generation must be deterministic. Runtime hooks must not write generated files
directly, because the CLI owns check mode. Generated paths cannot escape their
output directory. Checks detect missing and stale expected files; they do not
promise to remove obsolete files.

Core's codegen, generation and path tests, CLI `gen.test.ts`, and runtime phase
tests cover safe paths, output layout and command behavior. The VST3
runtime's golden descriptor is compiled by its native tests.

## Changing generators

Put shared plugin code in the runtime package or generated framework. Starter
files are for code users edit. Document migrations for existing source files;
changing a starter template only affects newly created crates. Legacy managed-host
migration checks must continue to protect customizations in old host directories.

Review generator output with its source changes. Run generation twice with a
Rust edit between calls to verify preservation, then run `gen --check`. Keep
secrets, timestamps and transient machine state out of deterministic output.
