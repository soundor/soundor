---
title: 'Packages'
description: 'Every package in the repository, what it is responsible for, and how they depend on each other.'
---

The repository is a pnpm workspace: published packages under `packages/`,
the runtimes and the engine under `runtimes/`, private shared configs under
`configs/`, the examples under `examples/` and the website under
`apps/website`.

How the published packages depend on each other (`dependencies` and
`peerDependencies`; an arrow points at what a package needs):

```mermaid
flowchart LR
    cli["soundor (CLI)"] --> config["@soundor/config"]
    cli --> core["@soundor/core"]
    cli --> dtserver["@soundor/devtools-server"]
    cli --> dtclient["@soundor/devtools-client"]
    dtserver --> dtprotocol["@soundor/devtools-protocol"]
    config --> core
    core --> engine["@soundor/engine"]
    sdk["@soundor/runtime-sdk"] --> config
    sdk --> core
    juce["@soundor/juce-runtime"] --> config
    juce --> core
    juce --> engine
    web["@soundor/web-runtime"] --> config
    web --> core
    vitest["@soundor/vitest"] --> config
    vitest --> core
    vitest --> testruntime["@soundor/test-runtime"]
    env["vitest-environment-soundor"] --> testruntime
    tl["@soundor/testing-library"] --> react["@soundor/react"]
    tl --> testruntime
```

`@soundor/react` depends on no Soundor package: it compiles against the
`soundor:*` declarations, which every runtime provides. `create-soundor-app`
depends on none either: it copies a template and installs the others.

| Area              | Package                                                                                                                                                                         | Responsibility                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Configuration     | [`@soundor/config`](/docs/cli/config)                                                                                                                                           | Config loading, validation, runtime types, and user settings                                 |
| Runtime authoring | [`@soundor/runtime-sdk`](/docs/contribute/runtime-sdk)                                                                                                                          | Factories and lifecycle hooks for runtime packages                                           |
| Shared toolchain  | [`@soundor/core`](/docs/contribute/core)                                                                                                                                        | Code generation, paths, errors, logging, commands, and shared helpers                        |
| Commands          | [`soundor`](/docs/cli)                                                                                                                                                          | `init`, `gen`, `dev`, `build`, and `doctor`; UI bundling and development sessions            |
| New projects      | [`create-soundor-app`](/docs/cli/create-soundor-app)                                                                                                                            | Project template, dependency installation, and runtime initialization                        |
| UI                | [`@soundor/react`](/docs/react)                                                                                                                                                 | React reconciler, components, hooks, focus scopes, portals, and modals                       |
| Native engine     | [`@soundor/engine`](/docs/contribute/engine-reference)                                                                                                                          | Backend-independent C++ UI engine and Hermes module lowering                                 |
| Native host       | [`@soundor/juce-runtime`](/docs/juce-runtime)                                                                                                                                   | JUCE code generation, parameter and native API adapters, plugin builds                       |
| Browser host      | [`@soundor/web-runtime`](/docs/web-runtime)                                                                                                                                     | DOM-backed UI, Web Audio host, browser services, and Vite integration                        |
| DevTools          | [Client](/docs/contribute/devtools-client), [server](/docs/contribute/devtools-server), [protocol](/docs/contribute/devtools-protocol)                                          | Browser dashboard, authenticated session backend, and shared transport contract              |
| Testing           | [Vitest plugin](/docs/testing/vitest), [environment](/docs/testing/vitest-environment-soundor), [Testing Library](/docs/testing), [test runtime](/docs/contribute/test-runtime) | Per-test runtime isolation, semantic queries, interactions, and deterministic animation time |

The engine is versioned independently of the shared package release group.
The JUCE runtime depends on an exact engine version. `@soundor/core` re-exports
the engine's JavaScript module-lowering tool; the engine does not depend on core.
