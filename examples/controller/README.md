# Soundor Controller

A ring modulator whose native methods are Rust: the plugin's **controller**
(`native/src/controller.rs`), beside its **processor** (`native/src/lib.rs`).
Both are the one crate, `native/`; `soundor::export!(PluginProcessor,
PluginController)` makes them what the JUCE runtime runs.

- `click()` is synchronous: it runs on the control thread inside the
  JavaScript call, and counts in the controller's local store, which lasts
  as long as the plugin instance, editor open or not.
- `clickLater()` is async: JavaScript gets a promise, the controller's worker
  runs the future, and `ctx.schedule()` runs the count on the control thread
  and returns it.
- `loadTable(shape, size)` computes a wavetable off the control thread
  (`soundor::unblock`), publishes it to the processor as an audio resource
  (real-time safe: the audio thread takes it at its next block), then records
  the shape in the persistent state from the control thread. Should that
  update wait more than a second, it is dropped while queued, and never runs:
  a cancelled scheduled task.
- `stats()` reads both stores: the local one's clicks, the shared one's loads.

The methods are declared in `soundor.config.ts`; `soundor gen` generates the
`NativeMethods` trait the controller implements, so a method missing, or of
another type, is a compile error. See the
[Rust controller](https://soundor.dev/docs/rust-controller) guide.

```sh
pnpm --filter controller dev         # the plugin, in the VST3 host or the Standalone
pnpm --filter controller test        # the UI, with the methods mocked
pnpm --filter controller test:rust   # the processor and the controller, in Rust
```

The controller runs in the JUCE runtime; the Web runtime keeps its own
TypeScript native methods, so this example is native only.
