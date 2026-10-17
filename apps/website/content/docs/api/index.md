---
title: API
description: Every module a plugin UI imports, and the tools that build and test it.
---

A plugin UI imports `@soundor/react` and the runtime's `soundor:*` modules.
Every runtime implements the same modules, with the same behavior and the
same errors, generated from the project's `soundor.config.ts`.

| Module                                       | What it is                                                        |
| -------------------------------------------- | ----------------------------------------------------------------- |
| [`@soundor/react`](/docs/api/react)          | Rendering, hooks and styles; the [components](/docs/components).  |
| [`soundor:parameters`](/docs/api/parameters) | The plugin's parameters, shared with the audio and the host.      |
| [`soundor:host`](/docs/api/host)             | The plugin's identity, the host, and its transport.               |
| [`soundor:ui`](/docs/api/ui)                 | The plugin view's nodes, styles, events, canvases and animations. |
| [`soundor:storage`](/docs/api/storage)       | Persistent JSON key/value storage, private to the plugin.         |
| [`soundor:fs`](/docs/api/fs)                 | Files in the plugin's private data directory.                     |
| [`soundor:native`](/docs/api/native)         | The plugin's own typed native API, declared in its config.        |

The `soundor:*` modules are declared for TypeScript in
`.soundor/generated/` (`soundor gen` writes it), so their types follow the
config: `parameters.gain` exists because the config declares `gain`.

Besides them, a plugin UI has a subset of the Web's globals: `console`,
timers, `fetch`, `URL`, `TextEncoder`, `crypto.getRandomValues()`,
`structuredClone`, `AbortController`, `requestAnimationFrame` and others.
There is no `window` or `document`: see the
[Web platform layer](/docs/contribute/engine-reference#the-web-platform-layer).

The tools: the [config](/docs/api/config), the [CLI](/docs/api/cli),
[`create-soundor-app`](/docs/api/create-soundor-app) and the
[runtime SDK](/docs/api/runtime-sdk); for tests,
[`@soundor/testing-library`](/docs/api/testing-library),
[`@soundor/vitest`](/docs/api/vitest) and
[`vitest-environment-soundor`](/docs/api/vitest-environment-soundor).
