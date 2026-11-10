---
title: 'Dependencies and compatibility'
description: 'How Soundor packages declare dependencies, communicate across installed copies, and how runtimes declare the Soundor versions they support.'
---

## Purpose

Soundor's shared packages are released together; its runtimes, first-party or
not, are released on their own. A project can therefore hold several copies of
`@soundor/config` or `@soundor/core`: the CLI's, and a runtime's own, of the
same version or another. These rules keep that working: each package declares
what it uses, nothing depends on two copies being one, and a runtime states
which versions it supports, which the CLI checks before running it.

## Where the code is

- `packages/core/src/errors.ts`: the error protocol, `isSoundorError()` and
  `RuntimeCompatibilityError`.
- `packages/core/src/version-range.ts`: versions and version ranges.
- `packages/config/src/compatibility.ts`: `checkRuntimeCompatibility()`, which
  `resolveRuntime()` calls; `project.ts`: the project's `@soundor/config`
  check; `version.ts`: `CONFIG_VERSION` and `CONFIG_SCHEMA_VERSION`.
- `packages/runtime-sdk/src/runtime.ts`: `defineRuntime()`, which requires the
  declaration; `copies.test.ts`: separately installed copies working together.
- `.github/scripts/runtime-compatibility.mjs`: the check that declarations
  cover what is tested and released.
- `packages/cli/scripts/runtime-consumer-smoke.mjs`: the runtimes installed
  from their tarballs.

## How it works

### Declaring dependencies

| Field                               | When                                                                                                                                                                                                                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dependencies`                      | The package's emitted JavaScript imports it, or its published declarations name its types. Declare it directly, even when another dependency happens to bring it.                                                                                                                        |
| `devDependencies`                   | Tests, build tools, fixtures, and code inlined into the bundle (such as `@soundor/core/spring` in the test runtime). A type-only import belongs here only if no published `.d.ts` refers to it.                                                                                          |
| `peerDependencies`                  | The project must provide the one copy everything shares: React for `@soundor/react`'s reconciler, Vitest and Vite for their plugins, the VST3 host for `@soundor/vitest-e2e`.                                                                                                            |
| `peerDependenciesMeta` (`optional`) | An integration the package supports when the project installs it, and works without: `@soundor/vst3-host` for the Driver's `vst3` entry and for `soundor dev` of the JUCE runtime, React for Testing Library. The code must import it lazily and say what to install when it is missing. |

A peer is not a way to avoid duplicates: if a package runs another's code,
it depends on it. Shared packages depend on each other at `workspace:*` (they
are one fixed version group, tested together); runtimes, released on their
own, depend on them at `workspace:^`. Check the emitted entry points after a
change (`grep 'from "@soundor/' dist/*.mjs dist/*.d.mts`): bundlers inline a
development dependency and keep a dependency external.

The CLI depends on `@soundor/config`, which parses the project's config. The
project installs `@soundor/config` too, for its types: the CLI never loads
that copy (it replaces the config's import of it with a shim when it
evaluates the file), but requires it to be of its own release line, the same
minor before 1.0, since it says which schema the config was written for.

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

### Runtime compatibility

A runtime declares what it supports in its `package.json`:

```json
{
  "name": "soundor-runtime-acme",
  "version": "1.4.0",
  "soundor": {
    "compatibility": {
      "config": ">=0.17.0 <0.18.0",
      "core": ">=0.17.0 <0.18.0",
      "schemas": [1]
    }
  }
}
```

and passes it to `defineRuntime()`, which requires it:

```ts
import type { RuntimeFactory } from '@soundor/config';
import { defineRuntime } from '@soundor/runtime-sdk';

import { name, soundor, version } from '../package.json';

export const acmeRuntime: RuntimeFactory<AcmeOptions> = defineRuntime({
  id: 'acme',
  package: { name, version, compatibility: soundor.compatibility },
  // init, gen, dev, build, doctor
});
```

- `config` and `core` are version ranges of the **host's** packages: the
  `@soundor/config` that parses the config and drives the phases, and the
  `@soundor/core` whose context and errors the runtime receives. They are not
  the runtime's own dependency ranges, which only say what it imports.
  Ranges are space-separated comparators (`>=`, `>`, `<`, `<=`, `=`), `^` and
  `~`, joined by `||`, with complete versions; `<0.18.0` excludes 0.18.0's
  prereleases.
- `schemas` lists the config schema versions (`CONFIG_SCHEMA_VERSION`) the
  runtime handles every field of. The schema version changes with every
  setting a runtime could fail to honor: a new field, type or value.

`resolveRuntime()`, through which `soundor init`, `gen`, `dev`, `build` and
`doctor` reach a runtime, calls `checkRuntimeCompatibility()`, and each
command resolves every runtime it will run before it generates, bundles or
compiles anything. A runtime outside the host's versions is refused
(`INCOMPATIBLE_RUNTIME`, exit code 4) with what it supports and what it got:

```text
Runtime 'acme' (soundor-runtime-acme@1.4.0) does not support this project's Soundor version.
  @soundor/config 0.18.0: the runtime supports >=0.17.0 <0.18.0
  config schema 2: the runtime supports 1
Upgrade soundor-runtime-acme to a version that supports @soundor/config 0.18.0, or use soundor and @soundor/config at a version it supports.
```

A declaration that cannot be read (a range such as `latest`, no schemas) is
refused too (`INVALID_RUNTIME`, exit code 4), with the path of each problem;
it is never taken for a match or a mismatch. A runtime that declares nothing,
one made before declarations existed, runs with a warning; a later release
will refuse it. `doctor` reports an incompatible runtime as a failed check.

Within the version a runtime supports, it must not silently ignore what it
cannot do. The config schema rejects properties it does not have (a typo, or
a setting of a newer release) instead of dropping them, and a runtime throws
a `ConfigError` naming the path of anything it does not support.

### Choosing and updating ranges

Before 1.0 a minor release of the shared packages may break, so a range spans
the release lines the runtime has been tested with, and ends before the next
one. Run the runtime's tests against each version it claims.

The repository's tests run the workspace packages, which keep their version
number until the release but already have its changes. So a first-party
runtime's range covers the current version and, when a changeset bumps the
shared packages, the version that release will have: `>=0.16.0 <0.18.0`
while 0.16.0 is current and a minor is pending. Verify runs
`.github/scripts/runtime-compatibility.mjs`, which fails when a range
excludes either, or includes the line after; each runtime's
`compatibility.test.ts` fails when it does not accept the config schema it is
tested with.

When a change bumps `CONFIG_SCHEMA_VERSION`, add the new version to the
`schemas` of every runtime that implements it in the same change; a runtime
that cannot yet keeps the old list and is refused by the new host.

## Invariants and tests

- No cross-package value is recognized by `instanceof`, constructor or module
  identity. `packages/runtime-sdk/src/copies.test.ts` installs separately
  bundled copies of core, config and the SDK into distinct `node_modules`
  trees and runs the CLI's steps in a child Node process: same versions,
  compatible ones, incompatible ones, a malformed or missing declaration, and
  a project `@soundor/config` of another line.
- Every entry point refuses an incompatible runtime before writing anything
  (`gen.test.ts`, `build.test.ts` in the CLI).
- The runtimes install from their tarballs with strict, isolated pnpm and no
  automatic peers, and the installed CLI generates with them
  (`pnpm --filter soundor test:runtime-consumer`).

## How to change it

Adding a field to the config: bump `CONFIG_SCHEMA_VERSION`, implement it or
reject it in each runtime, and list the new version in the runtimes that
implement it. Changing what a phase receives: it is a `@soundor/config` or
`@soundor/core` change that runtimes must be checked against; release it as a
minor before 1.0. A new error that crosses packages: give it a code in
`SoundorErrorCode` and an exit code, and check it with `isSoundorError(error,
code)`.

### Migrating a third-party runtime

1. Add `soundor.compatibility` to its `package.json`, with the ranges and
   schemas it has been tested with.
2. Pass `package: { name, version, compatibility }` to `defineRuntime()`
   (required from `@soundor/runtime-sdk` 0.17.0).
3. Depend on `@soundor/runtime-sdk`, `@soundor/config` (whose
   `RuntimeFactory` types the exported factory, so projects can name it) and
   `@soundor/core` if it imports it, as regular dependencies; drop a
   `@soundor/config` peer. The CLI parses the project's config with its own
   copy; the runtime's is for its own imports and types.
4. Replace `instanceof SoundorError` or `instanceof ConfigError` on errors from
   other packages with `isSoundorError()` and `isConfigError()`.
