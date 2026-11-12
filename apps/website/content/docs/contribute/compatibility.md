---
title: 'Dependencies and compatibility'
description: 'How Soundor packages declare dependencies, communicate across installed copies, and how the runtime API version keeps independently released runtimes compatible.'
---

## Purpose

Soundor's shared packages are released together; its runtimes, first-party or
not, are released on their own. A project can therefore hold several copies of
`@soundor/config` or `@soundor/core`: the CLI's, and a runtime's own, of the
same version or another. These rules keep that working: each package declares
what it uses, nothing depends on two copies being one, and runtimes and the
CLI agree on a runtime API version, which changes only when what runtimes
depend on does.

## Where the code is

- `packages/core/src/errors.ts`: the error protocol, `isSoundorError()` and
  `RuntimeCompatibilityError`.
- `packages/config/src/version.ts`: the version numbers, written from the
  record; `compatibility.ts`: `checkRuntimeCompatibility()`,
  which `resolveRuntime()` calls, and `CONFIG_FEATURES`; `project.ts`: the
  project's `@soundor/config` check.
- `packages/config/runtime-api.json`: the record the versions follow — the
  contract's hashes and the release metadata (`released`, `min`, `next`) —
  checked by `src/__tests__/runtime-api.test.ts`.
- `packages/runtime-sdk/src/runtime.ts`: `defineRuntime()`, which gives a
  runtime its API version; `copies.test.ts`: separately installed copies
  working together.
- `packages/cli/scripts/runtime-consumer-smoke.mjs`: the runtimes installed
  from their tarballs.
- `scripts/resolve-release.mjs`: resolves the pending runtime API version
  at release; [Runtime API versions](/docs/contribute/versions) is its guide.

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
are one fixed version group, tested together). A runtime, released on its
own, depends on one: `@soundor/runtime-sdk` at `workspace:^`, which
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

### The runtime API version

Runtimes are released on their own, and the shared packages release a new
minor for changes most runtimes never see: React components, DevTools, the
Driver. So compatibility is not a matter of package versions. It is a
contract version, `RUNTIME_API_VERSION` in `@soundor/config`, which covers
only what a runtime depends on of its host: the `Runtime` interface, the
`LifecycleContext` and what it carries, the config a runtime receives, and
the error protocol.

A runtime declares nothing. `defineRuntime()` gives it the
`RUNTIME_API_VERSION` of the `@soundor/config` it is built with, its own copy
(through `@soundor/runtime-sdk`), as `runtime.apiVersion`; a runtime made
before API versions existed has none and implements version 1. The host
(`soundor`, through its own `@soundor/config`) runs runtimes from
`MIN_RUNTIME_API_VERSION` to its `RUNTIME_API_VERSION`.

`resolveRuntime()`, through which `soundor init`, `gen`, `dev`, `build` and
`doctor` reach a runtime, calls `checkRuntimeCompatibility()`, and each
command resolves every runtime it will run before it generates, bundles or
compiles anything. A runtime outside the host's range is refused
(`INCOMPATIBLE_RUNTIME`, exit code 4):

```text
Runtime 'acme' implements runtime API 3, newer than this soundor (@soundor/config 0.18.0), which runs runtime API 2.
Upgrade soundor and @soundor/config to a release the runtime is made for, or use an older release of the runtime.
```

An API version that is not a positive integer is refused too
(`INVALID_RUNTIME`). `doctor` reports a refused runtime as a failed check.

**Config features.** A config field added after the first runtime API version
is listed in `CONFIG_FEATURES` with the version that added it. A runtime of
an older version still runs, unless the project's config uses the field: then
it is refused, by path, rather than ignoring it:

```text
Runtime 'acme' implements runtime API 3, which does not have what this config uses:
  parameters[0].mapping: parameter mappings, from runtime API 4
Upgrade the runtime to a release that supports them, or remove them from the config.
```

And the config schema rejects properties it does not have (a typo, or a
setting of a newer release) instead of dropping them, so a config written for
a newer Soundor is refused by an older one.

**Deduplication.** A runtime's API version is that of its own copy of the
SDK, which the package manager may share with the CLI's when the versions
allow. That cannot change the answer as long as a runtime depends on one
release line of `@soundor/runtime-sdk` (`^0.17.0` before 1.0), its only
Soundor dependency, and the
version changes only in a minor release: every copy of a line has the same
version. A runtime that depends on a wider range (or makes the SDK a peer)
reports whatever copy it is given.

### Changing the runtime API version

A change to the contract fails `runtime-api.test.ts`, which records a hash of
each of its declarations (comments excluded) in
`packages/config/runtime-api.json`. Whoever makes the change decides:

- **runtimes cannot notice** (a rename of a private type, a stricter check):
  record it, no pending change, the version stays;
- **a compatible addition** (a context field, an optional config field):
  record `"next": "raise"` and keep `min`; tag a new config field in
  `CONFIG_FEATURES` with `since: NEXT_API_VERSION`; runtimes made for older
  versions run on;
- **a break** (a removed or changed field, a new requirement): record
  `"next": "break"`. Older runtimes are refused, so the shipped version
  becomes `min`.

Then `UPDATE_RUNTIME_API=1 pnpm --filter @soundor/config test` re-records
the declarations and writes the version numbers in `version.ts` — the file
is written from the record, never hand-edited. While the change is pending
the workspace already runs as the version it will ship. The release resolver
ships it as `released + 1`, advancing the record; a break raises `min` with
it; and a pending change ships only in a minor release before 1.0 (a major
from 1.0 on), which the resolver enforces.
[Runtime API versions](/docs/contribute/versions) is the full guide. The
first-party runtimes' tests
check that they implement the version they are built with; a runtime must
be checked against a raise, and released with it if it implements what the
raise adds.

## Invariants and tests

- No cross-package value is recognized by `instanceof`, constructor or module
  identity. `packages/runtime-sdk/src/copies.test.ts` installs separately
  bundled copies of core, config and the SDK into distinct `node_modules`
  trees and runs the CLI's steps in a child Node process: same versions,
  other package versions of one API version, an older runtime the host still
  runs, runtimes newer and older than the host supports, a runtime from
  before API versions, and a project `@soundor/config` of another line.
- Every entry point refuses an incompatible runtime before writing anything
  (`gen.test.ts`, `build.test.ts` in the CLI).
- The runtimes install from their tarballs with strict, isolated pnpm and no
  automatic peers, depend on one release line of the SDK, and the installed
  CLI generates with them (`pnpm --filter soundor test:runtime-consumer`).

## How to change it

Adding a field to the config, or to what a phase receives: see
[Changing the runtime API version](#changing-the-runtime-api-version). A new
error that crosses packages: give it a code in `SoundorErrorCode` and an exit
code, and check it with `isSoundorError(error, code)`.

### Migrating a third-party runtime

1. Make the runtime with `defineRuntime()` from `@soundor/runtime-sdk` 0.17 or
   later; it gets its runtime API version from it.
2. Depend on `@soundor/runtime-sdk` alone, at one release line (`^0.17.0`),
   and import from it what you imported from `@soundor/config` and
   `@soundor/core`; drop those dependencies and a `@soundor/config` peer.
3. Replace `instanceof SoundorError` or `instanceof ConfigError` on errors from
   other packages with `isSoundorError()` and `isConfigError()`.
