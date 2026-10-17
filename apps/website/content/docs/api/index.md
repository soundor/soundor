---
title: API
description: The soundor:* modules every runtime provides to a plugin UI.
---

A plugin UI imports the runtime's `soundor:*` modules: the plugin's
parameters, the host, the view, storage, files and the plugin's own native
API. Every runtime implements the same modules, with the same behavior and
the same errors, typed from the project's `soundor.config.ts`.

| Module                                         | What it is                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| [`@soundor/react`](/docs/components#rendering) | Rendering, hooks and styles; the [components](/docs/components).  |
| [`soundor:parameters`](/docs/api/parameters)   | The plugin's parameters, shared with the audio and the host.      |
| [`soundor:host`](/docs/api/host)               | The plugin's identity, the host, and its transport.               |
| [`soundor:ui`](/docs/api/ui)                   | The plugin view's nodes, styles, events, canvases and animations. |
| [`soundor:storage`](/docs/api/storage)         | Persistent JSON key/value storage, private to the plugin.         |
| [`soundor:fs`](/docs/api/fs)                   | Files in the plugin's private data directory.                     |
| [`soundor:native`](/docs/api/native)           | The plugin's own typed native API, declared in its config.        |

The `soundor:*` modules are declared for TypeScript in
`.soundor/generated/` (`soundor gen` writes it), so their types follow the
config: `parameters.gain` exists because the config declares `gain`.

Besides them, a plugin UI has a subset of the Web's globals: `console`,
timers, `fetch`, `URL`, `TextEncoder`, `crypto.getRandomValues()`,
`structuredClone`, `AbortController`, `requestAnimationFrame` and others.
There is no `window` or `document`: see the
[Web platform layer](/docs/contribute/engine-reference#the-web-platform-layer).

React components and hooks build on these modules: see
[Components](/docs/components) and [Hooks](/docs/hooks).
