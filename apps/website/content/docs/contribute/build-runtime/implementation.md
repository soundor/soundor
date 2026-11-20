---
title: 'Implementation choices'
description: 'Embed the Soundor engine or implement the contract on another platform.'
---

## Purpose

A runtime can reuse Soundor's C++ execution engine or implement the contract on
another platform. The VST3 and web runtimes show these two approaches.

## Where the code is

The engine's public API is under `engine/include/soundor/`, especially
`runtime/RuntimeHost.h`, `ui/Surface.h`, `platform/Platform.h` and the compositor
headers, and `editor/Editor.h`, the editor every native runtime shares. The
VST3 adapter lives in `runtimes/vst3-runtime/native/`. The independent browser
implementation is `runtimes/web-runtime/src/client/`.

## How it works

```mermaid
flowchart TD
    contract["Same UI bundle and contract"] --> engine["Embed the Soundor engine"]
    contract --> custom["Implement on another platform"]
    engine --> host["RuntimeHost: JS, modules, surface, services"]
    host --> backend["Backend: input, platform adapters, presentation"]
    custom --> browser["Example: browser JS, DOM, Web Audio, IndexedDB"]
```

### Embed the engine

Create one `RuntimeHost` per plugin view on the UI/message thread. Supply its
options: identity, UI resources and entry, parameter and host adapters, HTTP,
private data directory, and an `installModules` callback for generated native
bindings (the VST3 adapter's generic `soundor:*` modules, driven by its
descriptor). Optional services have explicit failure behavior; for example,
without a data directory, storage and filesystem operations reject.

Size the surface and feed it input through the public surface API. Call
`tick()` regularly on the owning thread to deliver changes, timers, animation
callbacks and completed async work. Run pending jobs after input. Present
damaged frames through the compositor; supply a shared GPU device when the
presentation backend supports it. Connect the surface's semantic tree to a
platform accessibility backend.

The engine owns Hermes, Yoga, Skia, modules and UI state. The backend owns the
native view, platform integration and presentation. Keep plugin
format and framework headers out of the engine. See the
[embedding reference](/docs/contribute/engine-reference#embedding-api) for the
API and [threading rules](/docs/contribute/engine-reference#threading-and-lifetime).

Reload means destroying the host and creating a new one. Audio-thread listeners
set lock-free flags; `tick()` delivers their changes on the UI thread. Background
workers return plain C++ results and operation IDs, never JavaScript values.

### Implement from scratch

Provide a module resolver, the Web globals subset, platform services and a
`soundor:ui` implementation with the shared semantics. The React renderer talks
to nodes through that module; it does not require the C++ engine.

The web runtime uses browser JavaScript and DOM nodes, Web Audio for audio, and
IndexedDB for persistence. It supplies Soundor layout defaults, focus and event
routing, semantic visibility and animation behavior on top of browser APIs.
User-defined native API functions run as TypeScript in the same host context.
The engine's Yoga runs as WebAssembly for layout; CSS only draws the boxes it
computes. Hermes and Skia are not part of the web implementation.

This route avoids the engine ABI, but it owns every semantic adaptation. DOM
defaults alone do not establish conformance. Compare invalid values, event
ordering, private persistence and teardown as carefully as successful rendering.

### Case study: VST3

Nothing is compiled per plugin. The Node package writes the plugin's
descriptor (the config as JSON) and a Cargo crate that embeds it and the UI
beside the project's own crate, and links the result with the prebuilt
adapter (Steinberg's SDK, a generic component, controller and view) and the
prebuilt engine. The adapter connects parameters, state, presets, host
information and the editor (`editor::Editor`) to the engine. The runtime
makes signing the final macOS bundle step. See
[the VST3 runtime's internals](/docs/contribute/vst3-runtime).

### Case study: web

The Node package generates the manifest and module wrappers, and configures Vite
to resolve `soundor:*`. A browser host context connects UI, parameters, native
functions and audio. The Preact shell hosts controls around the plugin viewport.
Embed and playground modes reuse that client with different presentation and UI
loading. See [the web runtime](/docs/web-runtime).

## Invariants and tests

Engine integrations must preserve UI-thread ownership, clean reload, symbol
isolation and GPU lifetime. The engine's native tests exercise these contracts;
The VST3 runtime's native tests, test plugin and pluginval check its
embedding. A different backend
needs its own view/input/presentation integration tests too.

Independent implementations must prove the same observable API semantics.
Web client unit tests cover modules and nodes, while browser tests check actual
DOM behavior and the full hosted application. Neither route can substitute
lifecycle tests for execution tests.

## How to change it

For an engine backend, implement public adapter interfaces and keep framework
code in the backend. Use the exact engine version for headers, static libraries
and bytecode tooling; preserve its hidden symbols and inline ABI namespace.
For an independent runtime, inventory the contract and build tests for each
platform adaptation. Both routes should report unsupported capabilities through
the contract's defined behavior, such as a `null` WebGL context without a device.
