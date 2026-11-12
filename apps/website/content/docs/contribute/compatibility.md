---
title: 'Dependencies and compatibility'
description: 'Package dependencies, runtime host peer ranges, and communication across installed copies.'
---

## Purpose

Soundor's shared packages are released together; its runtimes, first-party or
not, are released on their own. A project can therefore hold several copies of
`@soundor/config` or `@soundor/core`: the CLI's, and a runtime's own, of the
same version or another. These rules keep that working: each package declares
what it uses, nothing depends on two copies being one, and each runtime
provider declares its supported CLI versions through a `soundor` peer
dependency.

## Where the code is

- `packages/core/src/errors.ts`: the error protocol and `isSoundorError()`.
- `packages/config/src/project.ts`: the project's `@soundor/config` check.
- `packages/config/src/registry.ts`: runtime resolution and lifecycle dispatch.
- `packages/runtime-sdk/src/runtime.ts`: `defineRuntime()`; `copies.test.ts`:
  separately installed copies working together.
- `runtimes/*/package.json`: SDK dependencies and `soundor` peer ranges.
- `packages/cli/scripts/runtime-consumer-smoke.mjs`: strict installation of
  packed runtimes, generation, and rejection of an incompatible host peer.

## How it works

### Declaring dependencies

| Field                               | When                                                                                                                                                                                                                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dependencies`                      | The package's emitted JavaScript imports it, or its published declarations name its types. Declare it directly, even when another dependency happens to bring it.                                                                                                                        |
| `devDependencies`                   | Tests, build tools, fixtures, and code inlined into the bundle (such as `@soundor/core/spring` in the test runtime). A type-only import belongs here only if no published `.d.ts` refers to it.                                                                                          |
| `peerDependencies`                  | The package integrates with a host or a shared library: `soundor` for runtimes; React for `@soundor/react`'s reconciler, Vitest and Vite for their plugins, the VST3 host for `@soundor/vitest-e2e`.                                                                                     |
| `peerDependenciesMeta` (`optional`) | An integration the package supports when the project installs it, and works without: `@soundor/vst3-host` for the Driver's `vst3` entry and for `soundor dev` of the JUCE runtime, React for Testing Library. The code must import it lazily and say what to install when it is missing. |

A peer is not a way to avoid duplicates: if a package runs another's code,
it depends on it. Shared packages depend on each other at `workspace:*` (they
are one fixed version group, tested together). A runtime, released on its
own, has one regular Soundor dependency: `@soundor/runtime-sdk` at
`workspace:^`, which
re-exports all of `@soundor/config` and `@soundor/core`, so it has no copies
of them that its SDK's do not share, and its declarations name no package a
project lacks: a project's config type names only its own `@soundor/config`,
since `defineSoundorConfig` returns a `SoundorConfig`. Check the emitted entry points after a
change (`grep 'from "@soundor/' dist/*.mjs dist/*.d.mts`): bundlers inline a
development dependency and keep a dependency external.

The CLI depends on `@soundor/config`, which parses the project's config. The
project installs `@soundor/config` too, for its types: the CLI never loads
that copy (it replaces the config's import of it with a shim when it
evaluates the file), but requires it to be of its own release line, the same
minor before 1.0, since it says which schema the config was written for.

VST3 host consumers also declare a caret peer range (`workspace:^` in the
repository, published as `^%version:@soundor/vst3-host%`). Host API compatibility
is scoped to the current minor and its patches before 1.0. The host remains
optional for the Driver and JUCE runtime, and required for `@soundor/vitest-e2e`.

### Cross-package protocols

Two copies of a package are two module instances: their classes, symbols and
module state are distinct. A value that crosses from one package to another
(an error a runtime throws, a runtime the config registers, the context the
CLI hands a phase) is therefore recognized by a data contract, never by
`instanceof`, a constructor or a private symbol:

- **Errors** carry a stable `code` and `issues`, and the brand
  `Symbol.for('soundor.error.v1')`. `isSoundorError(value, code?)` checks all
  three, so the CLI recognizes a `ConfigError` or `EnvError` a runtime threw
  from its own `@soundor/core`, keeps its exit code, and does not wrap it as a
  runtime failure. `isConfigError()` and the Driver's `isDriverError()` follow
  the same rule. Subclasses remain classes, with stacks and causes; use
  `instanceof` only for errors your own code throws and catches. A code a copy
  does not know maps to the `INTERNAL` exit code.
- **Runtimes** are registered structurally: a `{ id, options, runtime }` entry
  whose `runtime` has an `id` and the five phases. The schema does not check
  how the object was made.
- **Shared state** is owned by an instance, not a module. Where state must be
  shared by copies on purpose, as the test runtime's context is between a test
  and its environment, it lives under a versioned `Symbol.for()` key on
  `globalThis`. A global symbol names a protocol; it is not a general
  substitute for module identity.

### Runtime host compatibility

A runtime declares its supported CLI releases in its package manifest:

```json
{
  "dependencies": {
    "@soundor/runtime-sdk": "^%version:@soundor/runtime-sdk%"
  },
  "peerDependencies": {
    "soundor": "^%version:soundor%"
  }
}
```

The SDK and CLI share the fixed package version. Before 1.0, a caret range
such as `^0.16.0` accepts `0.16.x` and excludes `0.17.0`. The runtime provider
owns that range: check a new Soundor minor, then publish a runtime release
that declares support. A wider range is appropriate only when the provider
supports all releases it includes.

The SDK is a regular dependency because the runtime imports its helpers and
types. The CLI is a peer because it loads and invokes the runtime; the runtime
does not need to import `soundor`. First-party runtimes use `workspace:^` for
both requirements, which pnpm writes as caret ranges when packing them.

The package manager reports an incompatible host peer according to its own
settings. Soundor does not read the peer range at startup, stamp a separate
contract version onto runtimes, or gate config fields by runtime version.
The config schema still rejects unknown fields, and the CLI still checks that
the project's `@soundor/config` belongs to its own release line.

## Invariants and tests

- No cross-package value is recognized by `instanceof`, constructor or module
  identity. `packages/runtime-sdk/src/copies.test.ts` installs separately
  bundled copies of core, config and the SDK into distinct `node_modules`
  trees. It checks lifecycle dispatch and error protocols across copies and
  compatible patch releases, plus the project's config version check.
- The runtimes install from their tarballs with strict, isolated pnpm and no
  automatic peers. The installed CLI generates with both runtimes, and an
  incompatible host peer fails installation
  (`pnpm --filter soundor test:runtime-consumer`).

## How to change it

When changing what a runtime receives, update the types and first-party
runtimes together, add a changeset, and check their supported CLI peer ranges.
A third-party provider must test the new host release and publish an updated
range before claiming compatibility.

A new error that crosses packages needs a code in `SoundorErrorCode` and an
exit code, and must be recognized with `isSoundorError(error, code)`.

### Migrating a third-party runtime

1. Declare `soundor` as a required peer at the CLI versions you support.
2. Depend on `@soundor/runtime-sdk` as a regular dependency and import from it
   what you imported from `@soundor/config` and `@soundor/core`.
3. Remove the runtime's numeric `apiVersion` and any runtime API version
   constants, feature gates or compatibility checks it imported.
4. Replace `instanceof SoundorError` or `instanceof ConfigError` on errors from
   other packages with `isSoundorError()` and `isConfigError()`.
