---
title: 'Architecture'
description: 'How a project becomes a plugin: build time and run time, rendering, threads and accessibility.'
---

Soundor has a build-time toolchain and runtime implementations. The toolchain
turns a project contract and UI source into generated bindings and bundles. Each
runtime supplies the same UI-facing modules using its own platform services.

## From project to runtime

```mermaid
flowchart TD
    Config["soundor.config.ts"] --> Toolchain["CLI: validate and generate"]
    Toolchain --> Contract["Types, manifests, and native bindings"]
    Source["src/main.tsx and npm dependencies"] --> Bundle["CLI: bundle UI"]
    Bundle --> ESM["bundle.mjs: ES module"]
    ESM --> Native["JUCE runtime: lowered for its engine"]
    Contract --> JUCE["JUCE plugin: your C++ host and DSP"]
    Contract --> Web["Browser host: your TypeScript and Web Audio"]
    Native --> JUCE
    ESM --> Web
    JUCE --> Engine["Soundor Engine: Hermes, Yoga, Skia, ANGLE"]
    Web --> Browser["Browser JavaScript, DOM, Canvas, ARIA"]
```

The CLI bundles npm dependencies into the UI and leaves `soundor:*` imports for
the runtime, in one ES module. The web runtime loads it as it is. The JUCE
runtime lowers it into a module function for Hermes, with the lowering of the
engine it links, and production builds compile that to bytecode with the
matching `hermesc`.

## Packages

The toolchain, the React renderer, the runtimes and the engine are separate
packages; a project installs the CLI, `@soundor/react` and its runtimes.
[Packages](/docs/contribute/packages) lists them all, for contributors.

## The runtime contract

Every runtime implements the `soundor:*` modules and the supported Web globals.
Generated TypeScript declarations come from the project configuration, so the
UI sees the configured parameters and native methods rather than an untyped
dictionary.

Matching semantics matter as much as matching signatures. The web runtime
reproduces native parameter clamping and gestures, input routing, layout
defaults, accessibility rules, and errors where applicable. A change to a
shared behavior usually needs native, web, and test-runtime updates.

The browser naturally has additional APIs. Portable UI code should compile
against Soundor's generated declarations without TypeScript's full `DOM`
library. Browser-host files have their own DOM-enabled TypeScript configuration.

## Native rendering

Each open native editor owns a `RuntimeHost`: a Hermes JavaScript world, UI
surface, runtime modules, services, and pending work. React updates the surface's
node tree through `soundor:ui`.

1. Yoga computes logical layout when it changes.
2. Skia rasterizes damaged UI content and 2D canvases into CPU layers.
3. Canvas WebGL draws through ANGLE into GPU textures when a device exists.
4. Soundor's compositor combines the layers and presents the frame.

The GPU compositor uses ANGLE on Metal or Direct3D 11 where available. Linux and
fallback paths use CPU composition. GPU WebGL can still exist with CPU
composition, where presentation requires readback. The compatible GPU
composition path shares textures without WebGL readback.

Damage tracking and caching avoid repeating layout, rasterization, and texture
uploads for unchanged content. Native opacity and transform animations can
advance in the C++ timeline without a JavaScript callback for each intermediate
frame. Paint animations repaint affected content. See the
[rendering reference](/docs/contribute/engine-reference#rendering) and
[animation contract](/docs/contribute/engine-reference#advanced-animations).

## Threads and ownership

JavaScript, node mutation, event dispatch, and native animation timelines run on
the UI/message thread. The generated editor calls `RuntimeHost::tick()` at
60 Hz to deliver pending parameter changes, run timers, and settle async work.

Audio callbacks execute your native DSP. Parameter listeners that may run on
the audio thread only set lock-free flags; the UI thread later delivers
subscriptions. JavaScript never executes on the audio thread.

Background I/O returns plain C++ results and an operation ID to the owning
thread. JavaScript values stay with their context. Reload tears down the old
host before creating a new one, including pending jobs and subscriptions.

Multiple plugins share a DAW process. Engine symbols have hidden visibility,
dependencies are statically linked, and the engine version determines its inline
C++ ABI namespace. Link-time checks reject incompatible headers and libraries.
See [Symbol isolation](/docs/contribute/engine-reference#symbol-isolation) and
[ABI versioning](/docs/engine#abi-versioning).

## Browser rendering and services

The same React renderer produces Soundor nodes backed by DOM elements. The web
runtime provides Yoga-like layout defaults, Soundor event routing and focus
behavior, and root/overlay stacking inside the plugin viewport.

One page or iframe owns one host context. The UI, `native.ts`, `audio.ts`, and
host controls share it directly. Native API calls are ordinary TypeScript calls;
there is no serialization boundary. Storage and the private file tree use
IndexedDB, isolated by plugin ID.

The CLI still bundles `src/main.tsx`. Vite serves or builds the browser host and
resolves the bundle's `soundor:*` imports. See the
[web runtime](/docs/web-runtime#vite-and-the-plugin-ui).

## Accessibility and input

Soundor derives a semantic tree from node accessibility properties, including
roles, labels, values, modal visibility, and logical ownership through portals.
That tree drives native platform bridges and the web runtime's ARIA attributes.

Windows and Linux use AccessKit; macOS uses Soundor's Apple bridge. The engine
also contains an iOS bridge, but Soundor has no iOS plugin build yet. JUCE
supplies the native view and attachment point. It does not define Soundor's
control semantics.

Pointer and keyboard routing also follow the Soundor tree. React's `Modal` and
`FocusScope` add keyboard focus management. Details and examples live in the
[React reference](/docs/components/accessibility),
[native accessibility reference](/docs/contribute/engine-reference#accessibility), and
[Apple bridge guide](/docs/contribute/apple-accessibility).

## Development and test boundaries

DevTools connects a browser dashboard to an authenticated local server. The
native development Standalone connects through a worker-based bridge, while
inspection and mutations run on the owning UI thread. Node references include a
generation so reload invalidates stale requests. Release builds exclude the
native debug bridge. See [CLI development](/docs/cli/devtools#inspecting-the-native-ui).

Application tests run in Node against an in-memory runtime. They use the real
React renderer and shared semantic rules, with a virtual clock for animations.
They cover observable UI behavior without doing layout, rendering, native
execution, or audio processing. Native suites and browser tests cover the
platform implementations. See [Testing](/docs/testing) and
[Contributing](/docs/contribute).
