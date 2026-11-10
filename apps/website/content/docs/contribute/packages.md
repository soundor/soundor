---
title: 'Packages'
description: 'Every package in the repository, what it is responsible for, and how they depend on each other.'
---

## Purpose

The repository is a pnpm workspace: published packages under `packages/`,
the runtimes under `runtimes/`, the engine under `engines/`, standalone hosts under `hosts/`
(the VST3 host), private shared configs under
`configs/`, the examples under `examples/` and the website under
`apps/website`.

## Where the code is

The table below maps packages to their source directories and guides. Each
package's `package.json` declares the dependencies that govern build ordering,
release versioning and affected-package detection.

## How it works

How the published packages depend on each other (`dependencies` and
`peerDependencies`; an arrow points at what a package needs):

```mermaid
flowchart LR
    cli["soundor (CLI)"] --> config["@soundor/config"]
    cli --> core["@soundor/core"]
    cli --> dtserver["@soundor/devtools-server"]
    cli --> dtclient["@soundor/devtools-client"]
    cli --> driver["@soundor/driver"]
    driver --> dtprotocol
    driver --> dtserver
    driver -. optional .-> host["@soundor/vst3-host"]
    dtserver --> dtprotocol["@soundor/devtools-protocol"]
    config --> core
    core --> environment["@soundor/environment"]
    sdk["@soundor/runtime-sdk"] --> config
    sdk --> core
    juce["@soundor/juce-runtime"] --> sdk
    juce --> engine["@soundor/engine"]
    web["@soundor/web-runtime"] --> sdk
    vitest["@soundor/vitest"] --> config
    vitest --> core
    vitest --> testruntime["@soundor/test-runtime"]
    env["vitest-environment-soundor"] --> testruntime
    e2e["@soundor/vitest-e2e"] --> driver
    e2e -. peer .-> host
    tl["@soundor/testing-library"] --> react["@soundor/react"]
    tl --> testruntime
```

The runtimes depend on one Soundor package, the SDK, which re-exports all of
config and core. The CLI's own `@soundor/config` parses the project's config,
and runs runtimes of the runtime API versions it supports
([Dependencies and compatibility](/docs/contribute/compatibility)).

`@soundor/react` depends on no Soundor package: it compiles against the
`soundor:*` declarations of `@soundor/environment` (a development dependency,
types only), which every runtime provides. Core copies the same declarations
into each project's `.soundor/generated`. `create-soundor-app`
depends on none either: it copies a template and installs the others.
`@soundor/vst3-host` depends on no Soundor package; `@soundor/driver` has it as
an optional peer for its `vst3` entry, so that a Driver user installs no
native executable. `@soundor/vitest-e2e` has it as a required peer, since its tests
need it.

| Area              | Package                                                                                                                                                                         | Responsibility                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Configuration     | [`@soundor/config`](/docs/cli/config)                                                                                                                                           | Config loading, validation, runtime types, and user settings                                                      |
| Runtime authoring | [`@soundor/runtime-sdk`](/docs/contribute/runtime-sdk)                                                                                                                          | Factories and lifecycle hooks for runtime packages                                                                |
| Library types     | [`@soundor/environment`](/docs/ui-library)                                                                                                                                      | `soundor:ui`, `soundor:host`, `soundor:storage`, `soundor:fs`, asset imports and the Web globals, as declarations |
| Shared toolchain  | [`@soundor/core`](/docs/contribute/core)                                                                                                                                        | Code generation, paths, errors, logging, commands, and shared helpers                                             |
| Commands          | [`soundor`](/docs/cli)                                                                                                                                                          | `init`, `gen`, `dev`, `build`, `doctor`, `driver`; UI bundling and development sessions                           |
| New projects      | [`create-soundor-app`](/docs/cli/create-soundor-app)                                                                                                                            | Project template, dependency installation, and runtime initialization                                             |
| UI                | [`@soundor/react`](/docs/react)                                                                                                                                                 | React reconciler, components, hooks, focus scopes, portals, and modals                                            |
| Native engine     | [`@soundor/engine`](/docs/contribute/engine-reference)                                                                                                                          | Backend-independent C++ UI engine and Hermes module lowering                                                      |
| Native host       | [`@soundor/juce-runtime`](/docs/juce-runtime)                                                                                                                                   | JUCE code generation, parameter and native API adapters, plugin builds                                            |
| Browser host      | [`@soundor/web-runtime`](/docs/web-runtime)                                                                                                                                     | DOM-backed UI, Web Audio host, browser services, and Vite integration                                             |
| DevTools          | [Client](/docs/contribute/devtools-client), [server](/docs/contribute/devtools-server), [protocol](/docs/contribute/devtools-protocol)                                          | Browser dashboard, authenticated session backend, and shared transport contract                                   |
| Driver            | [`@soundor/driver`](/docs/driver)                                                                                                                                               | Connected inspection of running plugins from Node.js and `soundor driver`                                         |
| Testing           | [Vitest plugin](/docs/testing/vitest), [environment](/docs/testing/vitest-environment-soundor), [Testing Library](/docs/testing), [test runtime](/docs/contribute/test-runtime) | Per-test runtime isolation, semantic queries, interactions, and deterministic animation time                      |
| End-to-end tests  | [`@soundor/vitest-e2e`](/docs/testing/e2e)                                                                                                                                      | Vitest tests of a built VST3 plugin, UI and audio, in the VST3 host                                               |
| Plugin host       | [`@soundor/vst3-host`](/docs/testing/vst3-host) ([internals](/docs/contribute/vst3-host))                                                                                       | A standalone VST3 host executable driven from Node.js: offline processing, editors, platform packages             |

`@soundor/yoga-wasm`, [the engine's Yoga as WebAssembly](/docs/contribute/yoga-wasm),
lives beside it in `engines/`, and the web runtime depends on an exact version.

The engine and the VST3 host are versioned independently of the shared
package release group.
The JUCE runtime depends on an exact engine version, and lowers the UI bundle
with that engine's JavaScript module-lowering tool. Neither the engine nor core
depends on the other.

## Invariants and tests

The dependency graph must describe every input a package consumes in CI.
Native job detection uses `turbo query affected`, so an undeclared dependency
can skip a required build. `.github/scripts/native-changes.test.mjs` exercises
that detection, and package build and consumer smoke tests check published
entry points.

The React renderer compiles against portable `soundor:*` declarations; it must
not import a concrete runtime. Its private testing workspace prevents a cycle
between renderer and testing helpers. Engine headers and sources remain
backend-independent, with JUCE code in the JUCE runtime.

## How to change it

Put a feature in the package that owns its contract and lifetime. Declare any
new package dependency in `package.json` using the workspace catalog or
workspace protocol as appropriate. Build and test consumers of a changed
public entry point, and add a changeset when a published package changes.
