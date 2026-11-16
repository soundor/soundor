---
title: 'Controller'
description: 'A Rust controller: synchronous and async native methods, its stores, schedule(), and a resource published to the processor.'
---

Source: [`examples/controller/`](https://github.com/soundor/soundor/tree/main/examples/controller).

Run this page’s package-local commands from `examples/controller/`, unless noted otherwise.

A ring modulator whose native methods are Rust: the plugin's
[controller](/docs/rust-controller), beside its processor, in one crate. It
runs the same Rust controller in JUCE and web: use `pnpm dev` or
`pnpm dev:web`.

```text
soundor.config.ts         the `rate` and `depth` parameters, the `shape` state, the methods, the `wavetable` resource
src/App.tsx               the UI: calls the methods, awaits the async ones
lib/src/lib.rs            registers both modules
lib/src/processor.rs      the processor: the input times the wavetable, at `rate`
lib/src/controller.rs     the controller: its stores and NativeMethods
lib/tests/                the processor and the controller, tested in Rust
```

| Method                   | Kind  | Shows                                                                                                  |
| ------------------------ | ----- | ------------------------------------------------------------------------------------------------------ |
| `click()`                | sync  | the local store, kept between calls and while no editor is open                                        |
| `clickLater()`           | async | a promise; `ctx.schedule()` reaching the local store from the worker, its return value awaited         |
| `stats()`                | sync  | both stores: the local one's clicks, the shared one's loads                                            |
| `loadTable(shape, size)` | async | bounded cooperative work, a resource published to the separate processor, and a scheduled state update |

```sh
pnpm dev         # the plugin, in the VST3 host or the Standalone
pnpm test        # the UI, the methods mocked (mockNative)
pnpm test:rust   # the processor and the controller (TestController)
```
