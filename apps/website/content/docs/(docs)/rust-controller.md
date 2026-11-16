---
title: 'Rust controller'
description: "soundor:native's methods in Rust: typed by the config, on the control thread, with async tasks that schedule back onto it."
---

A plugin's Rust crate (`native/`) holds its [processor](/docs/rust-processor),
on the audio thread, and its required **controller**, on the control thread
beside the UI: the Rust behind the methods `soundor:native` exports. The
controller has the plugin's parameters, persistent state, History and presets
as the UI has them, keeps data of its own between calls, and runs async work
whose results reach JavaScript as promises and the processor as audio
resources.

|            | Processor (`impl Processor`)               | Controller (`impl Controller`, `impl NativeMethods`)                      |
| ---------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| Runs on    | the audio thread, under its deadline       | the control thread (the message thread), and a worker for async methods   |
| Called by  | the host, every block                      | JavaScript, through `soundor:native`                                      |
| Reaches    | its block: parameters, state snapshot, I/O | parameters, persistent state, History, presets, the processor's resources |
| Keeps      | its own fields (`&mut self`)               | two stores Soundor owns: `LocalStore` and `SharedStore`                   |
| Exists     | once per plugin instance                   | once per plugin instance, editor open or not                              |
| Runs where | the JUCE runtime and the Web runtime       | JUCE natively and the Web runtime through WASM                            |

The [controller example](/docs/examples/controller) is a complete plugin.

## Declaring methods

`soundor.config.ts` stays the one declaration of the native API. For a
plugin with a `gain` parameter:

```ts
state: {
  shape: { type: 'Shape', default: 'sine' },
},
native: {
  types: {
    Shape: { enum: ['sine', 'square'] },
  },
  methods: {
    reset: {},
    increment: { returns: 'int32' },
    loadTable: { args: { shape: 'Shape', size: 'uint32' }, returns: 'uint32', async: true },
  },
  resources: {
    wavetable: { type: 'buffer<float32>' },
  },
}
```

`soundor gen` generates JavaScript's types (`soundor:native`, as before) and,
in the Rust SDK, the `NativeMethods` trait, with one associated function per
method, its name in snake case:

```rust
pub trait NativeMethods: Controller + Sized {
    fn increment(ctx: &mut TaskContext<'_, Self>) -> i32;
    fn load_table(ctx: AsyncTaskContext<Self>, shape: types::Shape, size: u32)
        -> impl Future<Output = Result<u32, Error>> + Send;
    fn reset(ctx: &mut TaskContext<'_, Self>);
}
```

The compiler then enforces the contract: a method the config declares and the
controller does not implement, an argument or a result of another type, and a
synchronous method written as an async one (or the other way round) are
errors, as is an async method whose future is not `Send`. Nothing is
registered by hand, by name or by number. A config without methods generates
a trait every controller implements already: there is no empty `impl` to
write.

## A controller

```rust
use soundor::prelude::*;
use soundor::types::Shape;
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Default)]
pub struct LocalStore {
    counter: i32,
    selected: Option<Shape>,
}

#[derive(Default)]
pub struct SharedStore {
    requests: AtomicU64,
}

pub struct PluginController;

impl Controller for PluginController {
    type Local = LocalStore;
    type Shared = SharedStore;
}

impl NativeMethods for PluginController {
    fn increment(ctx: &mut TaskContext<Self>) -> i32 {
        ctx.store.local.counter += 1;
        ctx.store.local.counter
    }

    async fn load_table(ctx: AsyncTaskContext<Self>, shape: Shape, size: u32) -> Result<u32, Error> {
        ctx.store.shared.requests.fetch_add(1, Ordering::Relaxed);
        // Keep this computation bounded: browser futures run cooperatively.
        let table = render(shape, size);
        ctx.processor.resources().wavetable.publish(table);
        ctx.schedule(move |ctx| {
            ctx.store.local.selected = Some(shape);
            ctx.state.shape.set(shape);
        })
        .await?;
        Ok(size)
    }

    fn reset(ctx: &mut TaskContext<Self>) {
        ctx.store.local.counter = 0;
        ctx.params.gain.set(0.5);
    }
}

soundor::export!(PluginProcessor, PluginController);
```

`PluginController` is a type, never a value: Soundor never constructs it, and
its methods take their context rather than `self`. The names
`PluginProcessor` and `PluginController` are conventions; any names do.
Every plugin exports both types through
`soundor::export!(PluginProcessor, PluginController)`. A processor-only
export is a compile error, including for plugins without native methods.

`soundor init` always creates `native/src/lib.rs`, `controller.rs` and
`processor.rs`. Only `lib.rs` registers the two modules. Configured methods
get compiling default stubs; without methods, omit `impl NativeMethods`
because the generated trait supplies its blanket implementation.

## The stores

`Controller` names two stores, each `Default`. Soundor creates one of each
per plugin instance, when it is created, and drops them when it is
destroyed. Instances never share them.

- **`LocalStore`** (`type Local`) is the control thread's. Only synchronous
  methods and scheduled callbacks reach it, one at a time, through
  `ctx.store.local` (`&mut`). It needs no locks, and need not be `Send`: an
  `Rc` or a `RefCell` is fine.
- **`SharedStore`** (`type Shared`) is shared with async tasks, on any
  thread, through `ctx.store.shared` (`&`). It must be `Send + Sync`: atomics,
  a `Mutex`, channels.

Neither store is saved with the plugin, recorded in History, part of a
preset, or seen by the processor. Data that should last belongs in the
config's `state`, which `ctx.state` reads and writes; data the processing
reads, in `state` with `audio: true` or in a resource. Ordinary methods on
the store types work as usual.

## `TaskContext`: synchronous work

A synchronous method, and every callback scheduled onto the control thread,
gets a `&mut TaskContext`, made for that one call:

| Field          | What it reaches                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store.local`  | `&mut LocalStore`                                                                                                                                     |
| `store.shared` | `&SharedStore`                                                                                                                                        |
| `params`       | every parameter, typed as declared: `get()`, and `set()` for writable ones, as the UI edits them (constrained, recorded in History, told to the host) |
| `state`        | every persistent state field, typed as declared: `get()`, `set()` and `try_set()`, through the state store the UI uses                                |
| `history`      | `undo()`, `redo()`, `can_undo()`, `can_redo()`: the plugin's one History                                                                              |
| `presets`      | `ids()` and `load(id)`: the config's factory presets, loaded as `soundor:presets` does                                                                |
| `processor`    | `resources()`: the processor's audio resources, to publish                                                                                            |
| `plugin`       | `id` and `name`                                                                                                                                       |

These are the services the UI uses, not copies: a parameter set from Rust is
told to the host and to every editor as the UI's edits are, a state change
reaches the UI, History, the saved session and (for `audio: true` fields) the
processor's next block, and History undoes it like any other. `state.x.set()`
panics with the reason when the store refuses a value (an array beyond its
`maxLength`); `try_set()` returns it.

`TaskContext` is neither `Send` nor `Sync`, and borrowed for its call only:
it cannot be kept, moved to a thread, or held across an `.await` (async
methods get the other context). A synchronous method runs inside the
JavaScript call: it should be quick, as the UI waits for it (and the
[time limit](/docs/juce-runtime#options) counts it). Work that takes time is
an async method.

## `AsyncTaskContext`: async work

An `async: true` method gets an owned `AsyncTaskContext`, `Clone`, `Send` and
`Sync`, to keep across `.await`s and to move to other threads:

| Field / method | What it reaches                                                   |
| -------------- | ----------------------------------------------------------------- |
| `store.shared` | the `SharedStore` (a `SharedStore<C>` handle, which dereferences) |
| `processor`    | `resources()`, as `TaskContext` has it                            |
| `plugin`       | `id` and `name`                                                   |
| `schedule(f)`  | runs `f` on the control thread, with a fresh `TaskContext`        |

It has no local store, and no parameters, state, History or presets: those
are the control thread's, and `schedule()` reaches them. It refers to
nothing an editor owns, so it stays valid when the editor that called the
method closes.

Natively, its future is polled by the controller's worker: one thread per plugin
instance, started by its first async call. The worker is an executor and
nothing more: no timers, no I/O reactor. Blocking work (a file, a decoder,
a long computation) goes to `soundor::unblock(|| ...)`, which runs it on a
thread of its own and resolves to its result, so that it does not hold up
the instance's other tasks. A plugin that wants a full runtime may run its
own; Soundor requires none.

The future's `Ok` value resolves the JavaScript promise, converted as
declared; its `Err(Error)` rejects it with an `Error` of its message
(`loadTable(): <message>`). `soundor::Error` converts from any
`std::error::Error`, so `?` works on I/O and parsing errors as on a
`ScheduleError`. A panic rejects the promise too.

## `schedule()`

```rust
let counter = ctx
    .schedule(|ctx| {
        ctx.store.local.counter += 1;
        ctx.store.local.counter
    })
    .await?;
```

`schedule(f)` returns a future of `Result<R, ScheduleError>`, `R` being what
`f` returns. The callback runs on the control thread with a `TaskContext` of
its own, at the thread's next opportunity, never inside another call: no
JavaScript and no other callback runs meanwhile, and it never interrupts
JavaScript that is running. Callbacks run in the order they were queued.

A callback's own failure is its return value: with a fallible service,
`ctx.schedule(|ctx| ctx.presets.load("warm")).await??`, the first `?` for
scheduling, the second for the preset.

`ScheduleError` is why there is no value: `ShutDown` (the plugin instance was
destroyed before the callback ran, so it never will) or `Panicked(message)`.

### Laziness and cancellation

`schedule()` follows Rust's futures: it is lazy.

- **Created, never polled:** nothing is queued, and nothing runs.
- **First poll** (the first `.await`): the callback is queued.
- **Dropped while queued:** it is cancelled, and never runs. What it
  captured is dropped.
- **Dropped while running:** it runs to its end; dropping a future cannot
  interrupt it. What it returns is dropped, on the control thread.
- **The plugin instance destroyed:** every queued callback is dropped
  without running, and its future resolves to `Err(ScheduleError::ShutDown)`.

Taking a queued callback to run it, and cancelling it, hold the same lock:
exactly one of them wins. Cancellation stops what has not started, and
undoes nothing: a callback that ran has made its changes. To cancel a queued
callback, drop its future, as any Rust combinator does (a `select`, a
timeout):

```rust
// Record the table, unless the control thread does not get to it in time.
match within(Duration::from_secs(1), ctx.schedule(move |ctx| ctx.state.shape.set(shape))).await {
    Some(recorded) => recorded?,
    None => return Err(Error::new("not recorded in time")), // dropped while queued: it never ran
}
```

(`within` is the controller example's: it races the future with a timer.)
The worker polls a task only when it is woken, and drops a cancelled task's
future at its next suspension point, never in the middle of a poll.

## The control thread

JavaScript and the controller's synchronous code share one thread, the
control thread: the message thread in the JUCE runtime. Its work is:

1. one task at a time, run to its end: a JavaScript event or timer, a
   scheduled callback, or an async method's completion;
2. after a completion has settled its promise, that editor's microtasks (the
   promise's reactions run then, not at the next frame);
3. notifications (state, History, parameters) reach JavaScript through their
   usual paths, at the editor's next tick.

A synchronous native call runs inside the JavaScript call that made it. A
scheduled callback never runs inline: the runtime is woken (the JUCE runtime
through an `AsyncUpdater`, a message posted to the message loop) and runs
the controller's queue at the loop's next turn, one item at a time. It stops
after a few milliseconds of work and runs again at the next turn, so a
controller that schedules a lot never starves input, rendering or the host.
A call into the controller from inside one of its own calls (a service
calling back) is refused, rather than reentering the local store.

## Lifecycle

```text
plugin instance ─┬─ Processor           (audio thread)
                 ├─ LocalStore          (control thread)
                 ├─ SharedStore         (shared)
                 ├─ the controller's worker
                 └─ editors 0..n        (each its own JavaScript context)
```

The JUCE runtime creates the controller with the plugin instance (the
generated `soundor::AudioProcessor`), after its parameters, state, History
and presets, and shuts it down first when it is destroyed. Editors come and
go: opening one installs the controller's methods in its context, closing it
leaves the controller and its stores as they are, and every editor of an
instance calls the same controller.

**Async calls belong to the editor that made them.** When its context goes
(the editor closed, or reloaded in development), what it started is
cancelled: each task's future is dropped at its next suspension point, its
queued callbacks with it, and its promise never settles into the gone
context. Work that must outlive an editor belongs in the processor, or in
state the next editor reads.

**Shutdown** (the plugin instance destroyed) invalidates every queued
callback, drops every task on the worker, joins it, and drops the stores. No
callback runs after it, and no completion reaches JavaScript. An
`AsyncTaskContext` a detached `unblock` thread still holds stays memory-safe:
its `schedule()` then fails with `ShutDown`, and its resources reach no
processor.

## Types

Arguments and results are owned values:

| Config type          | Rust              | JavaScript          |
| -------------------- | ----------------- | ------------------- |
| `boolean`            | `bool`            | `boolean`           |
| `int8` … `uint32`    | `i8` … `u32`      | `number`            |
| `int64`, `uint64`    | `i64`, `u64`      | `bigint`            |
| `float32`, `float64` | `f32`, `f64`      | `number`            |
| `string`             | `String`          | `string`            |
| `T[]`                | `Vec<T>`          | `T[]`               |
| `buffer<T>`          | `Vec<T>` (copied) | a typed array       |
| `T?`                 | `Option<T>`       | `T \| null`         |
| a struct             | `types::Name`     | an object           |
| an enum              | `types::Name`     | its value, a string |
| `void`               | `()`              | `undefined`         |

Declared types are generated in `soundor::types` (structs with snake-case
fields, enums with `ALL`, `value()` and `from_value()`), and are the same
types `ctx.state` holds. JavaScript's values are checked as the C++ bindings
check them, with the same messages (`loadTable(): size: expected uint32, got
string`), before the controller is called.

## Runtimes

The JUCE runtime links the controller into the plugin. The web runtime
compiles that same crate to `wasm32-unknown-unknown`, creates one controller
on the browser main thread, and checks its generated contract before use.
Methods and stores have the same Rust types in both runtimes.

Browser futures run cooperatively through wake-driven event-loop tasks,
without workers or Tokio. `Send` futures and `Send + Sync` shared stores
remain required for portability; the browser adapter never treats a
non-`Send` JavaScript future as `Send`. Use asynchronous libraries compatible
with those bounds, and keep CPU work bounded or yield between chunks.
A CPU-heavy future that does not yield blocks browser rendering and input.
`unblock()` is unavailable when compiling to WASM: blocking work is never
silently run on the main thread. Native worker and `unblock()` behavior is
unchanged.

`schedule()` uses the same lazy queue and cancellation state machine in both
runtimes. Browser callbacks run serially on the main thread in later
event-loop tasks, with fresh contexts. They cannot interrupt a JS/WASM call.
Closing the plugin cancels pending futures and scheduled callbacks; closing
a UI call context rejects its pending calls without changing instance stores.
A callback already running finishes normally.

The browser's controller and AudioWorklet processor use separate WASM
instances. Resource publications are serialized by generated slot/type,
posted through the worklet's MessagePort, and installed between render
quanta. No Rust pointer crosses instances. The processor acquires complete
publications at block boundaries; replaced data is reclaimed outside the
audio callback. The newest publication is retained until audio starts or
restarts, and plugin destruction releases pending operations and resources.

## Migrating existing projects

Move processor code into `native/src/processor.rs`; keep module declarations
and the two-type export in `lib.rs`. Add the default controller and stores
even if there are no methods. Run `soundor gen` and rebuild both runtimes.

Remove the production `WebNativeApi` implementation and the `native` option
from `startSoundorWebHost`. For example, this former browser method:

```ts
export const native = { add: (a: number, b: number) => a + b };
```

becomes the implementation of the config's `add` method in `controller.rs`:

```rust
impl NativeMethods for PluginController {
    fn add(_ctx: &mut TaskContext<Self>, a: f64, b: f64) -> f64 {
        a + b
    }
}
```

The UI still imports `add` from `soundor:native`. Start the browser host
with `await startSoundorWebHost()`; no JavaScript method glue is needed.

## Testing

`soundor::testing::TestController` runs the controller as a runtime runs it
(its stores, queue, worker and dispatch), with `TestHost` standing in for the
runtime's services:

```rust
use soundor::prelude::*;
use soundor::testing::{TestController, TestProcessor};

#[test]
fn counts() {
    let controller = TestController::<PluginController>::new();
    assert_eq!(controller.task(PluginController::increment), 1);
    // Polls the future here, running scheduled callbacks as the control thread would.
    let later = PluginController::increment_later(controller.async_context());
    assert_eq!(controller.block_on(later).unwrap(), 2);
}

#[test]
fn publishes_the_wavetable() {
    let mut processor = TestProcessor::<PluginProcessor>::new().build();
    let controller = TestController::<PluginController>::for_processor(&processor);
    controller.block_on(PluginController::load_table(controller.async_context(), Shape::Square, 64)).unwrap();
    processor.process(&[vec![1.0; 64]]); // reads the new table
}
```

`controller.host()` reads what the controller did to the parameters, state
(as JSON), History and presets; `call()` and `call_async()` call a method by
name as the runtime does, with encoded arguments; `cancel()` and
`shutdown()` do what an editor closing and the plugin's destruction do. The
UI's own tests mock the methods with
[`mockNative`](/docs/testing/mock-native).

## Under the hood

JavaScript calls a method of `soundor:native`; the engine's generic bindings
check and encode its arguments, by the types of the config's controller
descriptor, and call the controller's C ABI (`soundor_controller_*`, which
`export!` defines); the generated dispatch decodes them and calls your
method. Results come back the same way. The engine knows no plugin's method
names: it reads them from the descriptor, which the runtime's generated code
and the Rust SDK both get from `soundor gen`, and compares the two, so a
stale build is refused rather than misread. See
[Rust controller hosting](/docs/contribute/engine-reference#rust-controller-hosting).
