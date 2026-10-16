# Soundor documentation

Soundor is a toolchain for audio plugins with TypeScript/React UIs. Declare the
plugin contract once, share the UI, and implement audio processing in the
runtime hosting it. Start with the reading path below, or jump to a reference.

[Project README](../README.md) · [The idea](overview.md) ·
[Getting started](getting-started.md) · [Architecture](architecture.md) ·
[Contributing](contributing.md)

## Start here

| Guide                                           | What it explains                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| [The idea behind Soundor](overview.md)          | What is shared across runtimes, what you implement, and where state belongs        |
| [Getting started](getting-started.md)           | Create a project, connect the UI, add the browser runtime, test, and build         |
| [Architecture](architecture.md)                 | Build-time and runtime boundaries, packages, rendering, threads, and accessibility |
| [Project lifecycle](project-lifecycle.md)       | Config → generated contract → UI bundle → runtime; file ownership and reloads      |
| [Parameters and host automation](parameters.md) | Typed parameter values, subscriptions, gestures, and the audio boundary            |

## Build a plugin

| Reference                                   | Use it for                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [React UI](react.md)                        | Components, layout styles, events, portals, modals, focus, accessibility, hooks, and animations |
| [Configuration](config.md)                  | Plugin identity, typed native API declarations, signing settings, and user settings             |
| [CLI](cli.md)                               | Commands, bundling, development sessions, DevTools inspection, and diagnostics                  |
| [Project scaffolder](create-soundor-app.md) | Creating a project from the template                                                            |
| [JUCE runtime](juce-runtime.md)             | Native plugin integration, C++ API bindings, formats, JUCE discovery, and signing               |
| [Web runtime](web-runtime.md)               | Browser host, DOM semantics, Web Audio, TypeScript API implementations, and static builds       |
| [Soundor Engine](engine.md)                 | Native engine modes, supported prebuilt platforms, ABI checks, caching, and troubleshooting     |
| [Testing guide](testing.md)                 | Application tests with semantic queries, interactions, service mocks, and animation time        |

## Examples

| Example                             | What to explore                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| [Basic](example-basic.md)           | One gain plugin with the same UI and separate JUCE/Web Audio implementations |
| [Primitives](example-primitives.md) | UI components, canvas drawing, focus, accessibility, and animation           |

Example source stays in [`examples/`](../examples); these pages document how to
run and test it.

## Testing references

| Package                      | Reference                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `@soundor/vitest`            | [Vitest plugin](vitest.md): configuration, generated declarations, isolation, and consumer validation |
| `vitest-environment-soundor` | [Environment](vitest-environment-soundor.md): worker and per-test lifecycle                           |
| `@soundor/testing-library`   | [Testing Library](testing-library.md): rendering, queries, user interactions, and test services       |
| `@soundor/test-runtime`      | [Simulated runtime](test-runtime.md): ownership, semantics, virtual clock, and simulation limits      |
| Private React test workspace | [Renderer tests](react-tests.md): dependency boundaries and focused test commands                     |

## Toolchain and DevTools references

| Reference                                        | What it covers                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| [Core](core.md)                                  | Shared toolchain utilities, runtime declarations, and spring helpers                 |
| [Runtime SDK](runtime-sdk.md)                    | Runtime authoring, lifecycle context, DevTools capabilities, and signing             |
| [DevTools client](devtools-client.md)            | Dashboard development, simulation scenarios, browser tests, and external backends    |
| [DevTools server](devtools-server.md)            | Authenticated HTTP/WebSocket backend, static serving, lifecycle, and testing helpers |
| [DevTools protocol](devtools-protocol.md)        | Transports, identity, control leases, methods, events, and diagnostic limits         |
| [Shared TypeScript config](typescript-config.md) | Workspace-only TypeScript configuration package                                      |
| [Shared tsdown config](tsdown-config.md)         | Workspace-only build presets                                                         |

## Native implementation and maintenance

| Guide                                         | What it covers                                                                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [Engine reference](engine-reference.md)       | Embedding API, JavaScript language support, modules, graphics, accessibility, dependencies, symbol isolation, builds, and animation contracts |
| [Apple accessibility](apple-accessibility.md) | macOS bridge attachment, plugin safety, lifetimes, coordinates, and manual checks                                                             |
| [iOS accessibility](ios-accessibility.md)     | Bridge implementation and device validation still needed; no iOS plugin runtime yet                                                           |
| [WebGL code generation](webgl-codegen.md)     | IDL inputs and checked-in generated bindings                                                                                                  |
| [Benchmarks](benchmark.md)                    | Headless scenarios, comparable baselines, work counters, and animation workloads                                                              |
| [Contributing](contributing.md)               | Workspace setup, checks, native builds, examples, generation, and documentation conventions                                                   |

## Navigating these docs

Every guide links back here and to the introductory guides. Longer references
have a contents list; the previous/next links at the bottom offer a continuous
reading path. Package READMEs link to these pages, which are the maintained
behavioral references.

Guides and references live in this folder. Source code, dependency license
notices, changelogs, and recorded benchmark reports stay with their owning
packages.
