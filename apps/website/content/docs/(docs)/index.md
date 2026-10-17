---
title: 'The idea behind Soundor'
description: 'What is shared across runtimes, what you implement, and where state belongs.'
---

Soundor separates an audio plugin's UI from the framework hosting it. You write
the UI in TypeScript and React, describe the plugin's public contract once, and
choose runtimes that implement that contract.

The same fader can control a C++ processor in a DAW and a Web Audio graph in a
browser. It imports `soundor:parameters` in both places; the runtime connects
that import to the appropriate parameter store.

## What a project contains

A project has three main parts:

1. **The contract:** `soundor.config.ts` declares the plugin identity,
   parameters, typed native API, and enabled runtimes.
2. **The UI:** `src/main.tsx` mounts React components from `@soundor/react`.
   The components use Soundor nodes, events, and services.
3. **The host implementations:** `runtimes/juce/` contains your C++ plugin;
   `runtimes/web/`, when enabled, contains your browser host and Web Audio code.

Soundor generates declarations and bindings from the contract. A parameter or
native method therefore has one declared shape that the UI and runtime
implementations agree on.

## What is shared

The UI, parameter definitions, native API declarations, and imports of
`soundor:*` modules are shared across runtimes. Pure TypeScript application
logic can be shared too, provided its dependencies use APIs the target runtimes
support.

| Shared interface     | What the UI uses it for                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| `soundor:parameters` | Read and update values, subscribe to changes, and bracket automation gestures |
| `soundor:host`       | Read plugin identity, host information, and transport snapshots               |
| `soundor:ui`         | Create nodes, route input, draw canvases, and submit animations               |
| `soundor:native`     | Call the plugin-specific API declared in the config                           |
| `soundor:storage`    | Persist JSON values for the plugin                                            |
| `soundor:fs`         | Read and write files inside the plugin's private data directory               |

The runtimes also provide a common subset of Web globals, including timers,
URLs, fetch, and text encoding. Generated declarations describe the supported
surface. The [engine reference](/docs/contribute/engine-reference#the-web-platform-layer)
documents the native implementation and its limits.

## What you implement per runtime

You own the audio processing and runtime-specific native methods. A gain plugin
can multiply a JUCE audio buffer in C++ and connect a browser `GainNode` in
TypeScript. Soundor supplies the contract and integration; it does not translate
one DSP implementation into the other.

The `native` name describes the API boundary from the UI's perspective. In a
JUCE plugin its methods call C++; in the web runtime they call your TypeScript
implementation directly. Long-running native work needs an asynchronous method
and appropriate background execution.

## How the UI reaches the screen

`@soundor/react` uses its own React reconciler. Components such as `View`,
`Text`, `Pressable`, and `Canvas` update a Soundor node tree.

- **JUCE:** Hermes executes JavaScript on the message thread. Yoga computes
  layout, Skia draws CPU layers, and Soundor composes them on the GPU where
  supported, or on the CPU. Canvas WebGL uses ANGLE.
- **Web:** the browser executes JavaScript and Soundor maps nodes to DOM
  elements, layout, canvas contexts, and ARIA attributes.

The native editor embeds the Soundor Engine. The browser runtime uses browser
APIs and contains no native engine or WebAssembly build. See
[Architecture](/docs/architecture) for the full flow.

## Where state belongs

React state is useful for transient UI details, such as an expanded panel.
Parameters represent values the host can automate and restore. Persistent UI
preferences can use `soundor:storage`; plugin-private files can use `soundor:fs`.

This distinction matters during development: a successful native UI rebuild
replaces the JavaScript runtime. React state, timers, and subscriptions are
recreated, while processor parameters and persisted data survive. Closing and
reopening the editor also creates a new UI runtime.

## Choosing a starting point

Start with [Getting started](/docs/getting-started) to create a project. Read
[Project lifecycle](/docs/project-lifecycle) before editing generated files, and
[Parameters](/docs/parameters) before connecting a control to host automation.
The [basic example](/docs/examples/basic) shows the complete two-runtime arrangement.
