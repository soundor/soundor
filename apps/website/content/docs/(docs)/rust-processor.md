---
title: 'Rust audio processing'
description: 'One lib/ crate, run through JUCE FFI and WebAssembly in an AudioWorklet.'
---

Write the UI in TypeScript and React and the audio processing in Rust. Both
runtimes execute the same `lib/` crate. JUCE supplies the plugin host
integration; the Web runtime supplies Web Audio routing and an AudioWorklet.

## Files and tools

`soundor gen` creates `lib/Cargo.toml`, `lib/src/processor.rs`, processor tests,
and `rust-toolchain.toml` once. The toolchain file requests `stable`. Install
Rust with Cargo before running the CLI; for the Web runtime also install
`rustup target add wasm32-unknown-unknown`. `soundor doctor` checks these
requirements and never installs them. Native plugin builds additionally need
the [JUCE toolchain](/docs/getting-started#requirements).

You own the crate, its `Cargo.lock`, its dependencies, and the toolchain file.
Soundor does not publish a required crate to crates.io. The installed `soundor`
npm package contains the SDK's Rust sources. `soundor gen` copies those sources
and generates the config-specific contract under
`.soundor/generated/rust/soundor/`. The crate's dependency is a normal Cargo
path dependency:

```toml
[dependencies]
soundor = { path = "../.soundor/generated/rust/soundor" }
```

Run `soundor gen` after installing or upgrading npm packages or changing the
config. Then Cargo and rust-analyzer work normally, without finding a package
inside `node_modules`. Add third-party dependencies with Cargo as usual; choose
ones that also support `wasm32-unknown-unknown` when using the Web runtime.
Soundor manages only its SDK integration, leaving unrelated dependencies alone.

## A processor

For a config with a float32 parameter named `gain`, `lib/src/processor.rs` can be:

```rust
use soundor::prelude::*;

#[derive(Default)]
pub struct PluginProcessor;

impl Processor for PluginProcessor {
    fn prepare(&mut self, _: &PrepareContext) {}

    fn process(&mut self, ctx: &mut ProcessContext) {
        let gain = ctx.params.gain;
        for channel in ctx.audio.channels() {
            for sample in channel {
                *sample *= gain;
            }
        }
    }
}

```

This deliberately has no smoothing. The gain scaffold created by `gen`
keeps the previous gain and ramps to the next value over a block to avoid
clicks. Smoothing belongs to the processor, independently of parameter mapping.

`Processor` requires `Default + Send + 'static`. Its only methods are
`prepare`, `process`, and an optional `reset`. Keep plugin-owned DSP state in
the struct (`PluginProcessor` is a convention; any name does). Plugin
identity, parameter registration, persistent state and supported buses remain
in `soundor.config.ts`. The crate also requires a
[controller](/docs/rust-controller), the Rust behind `soundor:native`'s
methods: `soundor::export!(PluginProcessor, PluginController)`.

## Lifecycle and audio

The runtime constructs a processor outside the audio callback. `prepare`
receives `sample_rate`, `max_frames`, the negotiated `layout`, and the current
parameters. Allocate delay lines and reusable scratch space here. It runs again
when the processing configuration changes. `reset` clears history between
blocks while retaining allocated capacity. Destruction happens outside processing.

`process` receives borrowed parameters, audio, transport, publication endpoints,
and the sample rate. Nothing borrowed from a context may be retained after the
call. Parameter values arrive once per block, already mapped by Soundor's
existing parameter expressions. The context does not define another parameter
or state system.

`ctx.audio.frames()` may be zero and may change each call. Each channel slice
has exactly that length. Main output channels start with the corresponding main
input, so `channels()` processes in place. A wider output starts with silence
in its extra channels. Other outputs start silent. `input(bus)` and
`output(bus)` access buses in config order; disabled input buses have zero
channels. Reading the main input after writing the main output reads the
modified samples. Read what you need before writing.

The config declares supported layouts; the runtime negotiates one and Rust
receives the active channel counts. `ctx.layout` in `prepare` exposes
`inputs()`, `outputs()`, and the matching config layout's `name()`. Hosts can
send blocks larger than prepared; adapters divide these into prepared-size calls.

### Reporting the effect tail in VST3

With `audio.tail: { mode: 'dynamic' }`, call
`ctx.report_tail_seconds(seconds)` in `prepare()` to report the initial
duration, and again in `process()` when a DSP setting changes the duration.
The tail is how long the effect can keep producing audio after its input goes
silent. It starts at zero on each prepare. Reports must be finite and
nonnegative. A report of zero clears the tail, and an invalid report leaves
the last duration in effect.

The VST3 host reads the latest duration when it queries the processor. With
a fixed tail, the host reads the configured duration regardless of any reports
from Rust.

## Generated parameters and publishing

`soundor gen` generates `soundor::config::Parameters` and layout constants from
the config. Field names use snake case: `sideChainGain` becomes
`ctx.params.side_chain_gain`. Numeric and boolean parameters retain their
types; choices become generated enums. Config defaults, ranges, snapping and
mapping remain authoritative. Use the generated type's documentation in your
editor rather than copying the contract into Rust.

The persistent state fields declared with `audio: true` arrive as
`ctx.state` (a generated `soundor::StateSnapshot`, also in `PrepareContext`),
typed as declared: `ctx.state.processing_mode` is an `i32`, an array a
`StateArray` that reads as a slice. A block sees one snapshot throughout, and
a change reaches the next block; see
[`soundor:state`](/docs/api/state#state-the-audio-processor-reads).

Read-only parameters are written through `ctx.publish`, and configured native
streams through `ctx.streams`. For example, the analyzer uses
`ctx.publish.peak(value)` to report its peak. These routes preserve Soundor's
existing publication semantics. The UI's native methods are the
[controller](/docs/rust-controller)'s, in the JUCE runtime, or a runtime's own
implementation; there are no arbitrary UI/audio message queues, and the
controller never reaches the processor's fields.

## Audio resources

Data the processing reads that has no fixed size, such as a wavetable, an
impulse response, a sample or a prepared lookup table, is an audio resource,
declared under `native.resources` (`wavetable: { type: 'buffer<float32>' }`).
`prepare()` publishes one, outside the audio thread, and every block from the
next reads it:

```rust
fn prepare(&mut self, ctx: &PrepareContext) {
    // Allocating is fine here: prepare runs outside the audio thread.
    let table: Vec<f32> = make_wavetable(ctx.sample_rate);
    ctx.resources.wavetable.publish(table); // moved, not copied
}

fn process(&mut self, ctx: &mut ProcessContext) {
    if let Some(table) = ctx.resources.wavetable.get() {
        // `table` is a &[f32], the same for the whole block.
    }
}
```

- **Immutable and whole.** A published resource is never changed. A block
  reads the latest publication before it started, from start to end. `get()`
  is `None` until one is published, and a resource may be empty.
- **Latest wins.** Publishing again replaces the resource from the next
  block. A publication the processing never read is freed by the one that
  replaces it.
- **Real-time safe.** Taking and reading a resource never allocates, frees,
  locks or waits: at a block's start the audio thread takes the latest
  publication with one atomic exchange (one load when there is none). A
  replaced resource is freed outside the audio thread, by the next
  publication, the next `prepare()` or the processor's destruction. Until
  then the audio thread keeps it, so an old resource may stay in memory
  until then.
- **Not state.** Resources are not saved with the plugin, are not part of
  presets or History, and the UI cannot read them. Publish them again in
  `prepare()` from what the processor has: its state, its parameters, the
  sample rate. Each processor instance has its own.
- **One handoff, any publisher.** Publishing takes `&self` and may run on any
  threads at once: `prepare()`, and the plugin's
  [controller](/docs/rust-controller) (`ctx.processor.resources()`, from a
  synchronous method or an async task), into the same handoff.

## Builds and development

`soundor build juce` compiles the crate to a native static library with Cargo
and links it into the JUCE plugin with CMake. `soundor build web` compiles it to
a WebAssembly module and includes it in the static Web build. `soundor dev`
watches the crate as well as the UI. Cargo's incremental cache lives under
`.soundor/cache/lib/`; UI-only rebuilds do not recompile the crate. Restart
development after changing the config or runtime-specific C++ host code.

The internal native ABI uses versioned, sized C structures and an opaque
instance handle. The adapter lends explicit channel pointers and lengths for
one call; no Rust collections cross the boundary. Main audio is borrowed in
place, with scratch copies only where overlapping bus mappings require them.
See [JUCE integration](/docs/juce-runtime#the-audio-processing).

Both adapters are the engine's (see
[Rust processor hosting](/docs/contribute/engine-reference#rust-processor-hosting));
the runtimes own the audio callback or the AudioContext and the plugin's
lifecycle.

The Web adapter instantiates the same processor in single-threaded WASM inside
an AudioWorklet. It allocates reusable linear-memory buffers before processing,
copies Web Audio inputs into them and outputs back, and handles variable render
quanta. Parameters and transport arrive by messages; meters return by messages.
Prepared memory views are reused for processing; unexpected WASM memory growth
fails the processor instead of constructing new views inside the callback.
It needs neither wasm-bindgen nor SharedArrayBuffer nor cross-origin isolation.
See [Web audio](/docs/web-runtime).

## Failure and real-time constraints

Processing and reset must not allocate, free heap memory, wait on locks, block,
perform I/O, or invoke JavaScript. Rust's type system does not enforce those
rules. Review dependencies as well as your own code. Preparing and destroying
may allocate; they must stay outside the callback.

Invalid lifecycle calls, ABI mismatches, unsupported layouts and invalid buffer
descriptors fail with a status and silence rather than running DSP. Native
panics are contained at the ABI; the failed instance stays silent until
reprepared. WASM panics trap the instance and the worklet reports failure and
stays silent; recreate it to recover. Never rely on catching a panic as part of
ordinary processing. Descriptor checks cannot make arbitrary foreign pointers
safe: the runtime must uphold the ABI's ownership and memory-validity rules.

Use [processor tests](/docs/testing/rust-processor) for lifecycle, audio, FFI and
allocation checks. These checks catch regressions on exercised paths; they do
not prove a hard real-time deadline or the absence of blocking in dependencies.
The browser's message serialization and JavaScript engine can allocate and
schedule garbage collection; the AudioWorklet adapter's message traffic does
not provide a hard real-time guarantee even when Rust processing allocates nothing.

## Migrating an existing project

1. Run `soundor gen` to create the Rust crate and toolchain file, then edit the processor.
2. Port plugin DSP from the JUCE `process` override and Web `audio.ts` to
   `Processor` in `lib/src/processor.rs`. Move reusable allocations to `prepare`.
3. Remove the JUCE DSP override; the generated processor now owns the JUCE
   processing lifecycle. Keep runtime-specific native methods and editor code.
4. Move custom Web input sources into a browser module and migrate to the
   [managed Web host](/docs/web-runtime#migration). Soundor owns audio hosting
   and routing.
5. Add Cargo tests, verify both builds, and compare their audio under equivalent
   parameters, transport and layouts. Preserve the config's parameter and state
   definitions so existing automation and saved sessions retain their meaning.

C++ remains inside the native runtime and engine, and TypeScript inside the Web
host. Plugin DSP has one supported implementation: the shared Rust crate.

## MIDI processing

`ctx.midi.input()` contains sample-offset-aware `MidiEvent`s. Apply messages at
`event.sample_offset` when rendering; output events go through
`ctx.midi.output().push(event)`, while observation is an explicit
`ctx.midi.publish(event)`. Both return a result and have bounded storage. Input
is never automatically echoed or broadcast. Implement `reset()` to silence
active voices and clear held notes after lifecycle changes or overflow.
See [MIDI](/docs/midi) and the [virtual piano](/docs/examples/midi) for full examples.
