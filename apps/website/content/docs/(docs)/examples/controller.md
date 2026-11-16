---
title: 'Controller'
description: 'A Rust controller: synchronous and async native methods, its stores, schedule(), and a resource published to the processor.'
---

Source: [`examples/controller/`](https://github.com/soundor/soundor/tree/main/examples/controller).

Run this page’s package-local commands from `examples/controller/`, unless noted otherwise.

A ring modulator whose native methods are Rust: the plugin's
[controller](/docs/rust-controller), beside its processor, in one crate. It
runs in the JUCE runtime (the controller is native), so this page has no
live example: run it with `pnpm dev`.

```text
soundor.config.ts         the `rate` and `depth` parameters, the `shape` state, the methods, the `wavetable` resource
src/App.tsx               the UI: calls the methods, awaits the async ones
native/src/lib.rs         the processor: the input times the wavetable, at `rate`
native/src/controller.rs  the controller: its stores and NativeMethods
native/tests/             the processor and the controller, tested in Rust
runtimes/juce/            JUCE host integration
```

| Method                   | Kind  | Shows                                                                                                                                                            |
| ------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `click()`                | sync  | the local store, kept between calls and while no editor is open                                                                                                  |
| `clickLater()`           | async | a promise; `ctx.schedule()` reaching the local store from the worker, its return value awaited                                                                   |
| `stats()`                | sync  | both stores: the local one's clicks, the shared one's loads                                                                                                      |
| `loadTable(shape, size)` | async | work off the control thread (`soundor::unblock`), a resource published to the processor, a state update scheduled and cancelled when it waits more than a second |

```sh
pnpm dev         # the plugin, in the VST3 host or the Standalone
pnpm test        # the UI, the methods mocked (mockNative)
pnpm test:rust   # the processor and the controller (TestController)
```
