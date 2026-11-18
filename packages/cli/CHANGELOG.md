# soundor

## 0.18.0

### Minor Changes

- [#326](https://github.com/soundor/soundor/pull/326) [`8002969`](https://github.com/soundor/soundor/commit/800296968109a085fd4711912ba196c7c650aede) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Require every plugin to export its Rust processor and controller. Scaffold separate entry, controller and processor modules, including an empty controller when no native methods are configured.

  Run the same generated Rust NativeMethods contract in browsers through WASM, with instance stores, wake-driven async execution, control-thread scheduling, host services and resource publication to the separate AudioWorklet processor. Remove production WebNativeApi implementations and the browser host's native option. Move those methods to Rust and regenerate/rebuild existing projects. The portable Send/Sync bounds remain; unblock is native-only, and browser futures execute cooperatively on the main thread.

- [#333](https://github.com/soundor/soundor/pull/333) [`085d5a6`](https://github.com/soundor/soundor/commit/085d5a607fde5a76fb87986d90f49b350bc75c41) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add independent bounded MIDI observer destinations, explicit controller opt-in and task-context sends, subscription generation tracking and a shared JavaScript MIDI facade for runtime adapters.

- [#333](https://github.com/soundor/soundor/pull/333) [`23162f7`](https://github.com/soundor/soundor/commit/23162f7bf06b592d48f129c3255bb5d2de47a856) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add the MIDI 1.0 channel message contract, integer byte conversions, and independent host MIDI input/output configuration (both disabled by default).

- [#333](https://github.com/soundor/soundor/pull/333) [`46649cc`](https://github.com/soundor/soundor/commit/46649cc40ca384bf0cf2bb1fc5da64ef38a6a771) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add sample-offset MIDI processing, fixed input/output/publication buffers, a bounded nonblocking sender, explicit overflow recovery and allocation-counted lifecycle tests to the shared Rust SDK.

- [#333](https://github.com/soundor/soundor/pull/333) [`c15667d`](https://github.com/soundor/soundor/commit/c15667dee72d1d70cb3bf8c19275791fd5fc93a6) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Wire MIDI into native and Web processor hosting, the JavaScript module, controller transport and test runtime. Add bounded AudioWorklet delivery, explicit Web MIDI device routing, JUCE capabilities, VST3 host virtual input/conversion and optional Linux ALSA input. MIDI effects default to an audio-free layout.

- [#321](https://github.com/soundor/soundor/pull/321) [`bb8b0a0`](https://github.com/soundor/soundor/commit/bb8b0a051a150d6edb2ef1859fae66bc3169f09d) Thanks [@dm-balakin](https://github.com/dm-balakin)! - **Breaking:** native channels are now called native streams, so they are not confused with an audio buffer's channels. The behavior is unchanged: they still go from audio to the UI only, keep only the latest value, deliver at most one value per frame, and publish without locks or allocations.

  - Config: `native.channels` is now `native.streams`, and no method can be called `streams`.
  - UI: `import { streams } from 'soundor:native'`, typed `NativeStream<T>`.
  - Rust: `ctx.streams.peak.publish(…)`. `soundor::Streams`, `ValueStream`, `BufferStream` and `StreamElement` replace `Channels`, `ValueChannel`, `BufferChannel` and `ChannelElement`. `TestProcessor::stream()` and `stream_buffer()` replace `channel()` and `channel_buffer()`.
  - C++: `soundor::native::Streams` replaces `native::Channels`, and the processor's member is `nativeStreams`. The engine's `soundor/js/Streams.h` declares `js::ValueStream<T>` and `js::BufferStream<T>`, with `js::deliverStreams()`, `bind::connectStreams()` and `bind::installStreams()`. `TickStatistics::streams` replaces `TickStatistics::channels`.
  - Tests: `publishStream(name, value)` from `@soundor/testing-library` replaces `publishChannel()`.
  - Web: the generated contract exports `streams` to the project's `runtimes/web` code. `@soundor/engine/web`'s processor takes `streams` and reports changes through `onStreams`.

  The Rust processor's binary interfaces keep their layout and their WebAssembly export names (`soundor_wasm_channel_*`), so the processor ABI version is unchanged.

- [#321](https://github.com/soundor/soundor/pull/321) [`b7dbe5f`](https://github.com/soundor/soundor/commit/b7dbe5fa46dca1be9c82094ae2482a37610aa194) Thanks [@dm-balakin](https://github.com/dm-balakin)! - **Breaking (processor ABI 2):** the Rust audio processor can read persistent state. A state field declared with `audio: true` keeps its usual persistence, presets and History, and the processor also reads it as `ctx.state` in `prepare()` and `process()`. `ctx.state` is a generated `soundor::StateSnapshot` that holds only the `audio: true` fields, typed as declared, so reading a UI-only field fails to compile. An audio field is a number, a boolean, or an array of them with a `maxLength` (`StateArray<T, N>`, which reads as a slice). `maxLength` is an array's capacity. Any array field may declare one, and every value of the field is checked against it on every write path (sets, restored projects, factory presets, History).

  A change reaches the next block. A block sees one snapshot from start to end, and fields written together arrive together. Reading takes no lock, allocates nothing and copies nothing. Natively, the engine's `processor::AudioState` (a triple buffer that `PersistentState::audioState()` owns) hands snapshots to the audio thread. In the browser, the page posts each snapshot to the AudioWorklet (`ProcessorNode.setState()`), which writes it into the module between render quanta.

  The processor ABI is now version 2: `SoundorPrepare` and `SoundorBlock` carry the state, and `SoundorProcessorInfo` and `RustContract` its size. Rebuild a plugin's processor with this SDK. `TestProcessor::state_mut()` sets the state in tests.

- [#321](https://github.com/soundor/soundor/pull/321) [`439c5f4`](https://github.com/soundor/soundor/commit/439c5f4355ba1656ac1c3b472ba93ff3fc701fb6) Thanks [@dm-balakin](https://github.com/dm-balakin)! - The Rust audio processor gains audio resources: immutable data of any length that the processing reads, such as a wavetable, an impulse response or a lookup table. Declare them under `native.resources` (`wavetable: { type: 'buffer<float32>' }`), publish them from `prepare()` (`ctx.resources.wavetable.publish(table)`, which moves the value instead of copying it), and read them in `process()` (`ctx.resources.wavetable.get()`, a `&[f32]` that stays the same for the whole block). The latest publication wins.

  Taking and reading a resource never allocates, frees, locks or waits. A replaced resource is freed off the audio thread: by the next publication, the next `prepare()`, or when the processor is destroyed. Resources are not saved with the plugin and are not part of presets or History. They live in the Rust SDK alone, so the processor ABI is unchanged.

- [#328](https://github.com/soundor/soundor/pull/328) [`3f303a0`](https://github.com/soundor/soundor/commit/3f303a014274a3b23d2a406db3e3aae44128c253) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Remove the `soundor init` command and runtime initialization hook. Runtime authors
  now implement only `gen`, `dev`, `build`, and `doctor`. Both first-party hosts
  remain package-managed, including the legacy-host migration diagnostics.

  `soundor gen` creates a Rust starter crate when `lib/Cargo.toml` is absent, preserving
  existing files and leaving existing crates untouched; development and builds run it automatically. Check mode remains read-only.
  New projects run generation after dependency installation.

- [#307](https://github.com/soundor/soundor/pull/307) [`d3fe0e2`](https://github.com/soundor/soundor/commit/d3fe0e284f82c13386d90c64803fb1e6475ab91e) Thanks [@dm-balakin](https://github.com/dm-balakin)! - **Breaking:** a plugin's audio processing is Rust, in the project's `lib/` crate, and the JUCE runtime runs it. `soundor init` scaffolds `lib/` (a processor and its tests) and `rust-toolchain.toml`; `soundor gen` writes the `soundor` crate the processor depends on, the Rust SDK shipped in the `soundor` package, with the config's parameters, read-only parameters, native streams and audio layouts typed for it; `soundor dev` and `soundor build` compile it with Cargo, and `soundor doctor` checks for Rust. The generated `soundor::AudioProcessor` now implements `prepareToPlay()`, `reset()` and `processBlock()` itself and calls the Rust processor through its C ABI: a JUCE processor no longer implements `process()`, and a project's `PluginProcessor` keeps only what is not processing (its editor, its buses without an `audio` declaration, its native API). Runtimes receive the crate as `ctx.lib`.

  Rust static libraries link directly using the plugin's existing export controls. Windows needs no LLVM archive/object rewriting tools, and Linux Release binaries still omit debug information.

- [#307](https://github.com/soundor/soundor/pull/307) [`3734cf5`](https://github.com/soundor/soundor/commit/3734cf524b2234af6de3368bfe4b1833aa73aa21) Thanks [@dm-balakin](https://github.com/dm-balakin)! - **Breaking:** the Web runtime runs the plugin's Rust processor, `lib/`, the one the JUCE plugin runs: `soundor dev web` and `soundor build web` compile it with Cargo for `wasm32-unknown-unknown`, the bundle carries the module, and the host runs it in an AudioWorklet (no wasm-bindgen, no `SharedArrayBuffer`, render quanta of any length), with the parameters and the transport posted to it and what it publishes (read-only parameters, native streams) brought back to the UI. `startSoundorWebHost()` no longer takes `audio`, and `WebAudioSetup` is gone: delete `runtimes/web/src/audio.ts` and move its processing into `lib/`. `init` no longer scaffolds `audio.ts`, and `soundor doctor` checks for the `wasm32-unknown-unknown` target. The Rust SDK's `soundor::export!` also defines the WebAssembly exports the worklet calls (`soundor_wasm_*`), on that target only. `createProcessorNode()` runs a processor module in any `BaseAudioContext`.

- [#325](https://github.com/soundor/soundor/pull/325) [`ec9f9e7`](https://github.com/soundor/soundor/commit/ec9f9e734c75fe1b6622df88a8862a45aa8008bf) Thanks [@dm-balakin](https://github.com/dm-balakin)! - A plugin's `soundor:native` methods can be Rust: the crate's controller, on the control thread beside the UI, typed by soundor.config, with async tasks that schedule back onto it.

  - `soundor` (the Rust SDK): **breaking**, the processor trait `AudioProcessor` is now `Processor` (`impl Processor for PluginProcessor`); its lifecycle is unchanged. New: `Controller` (`type Local`, `type Shared`: two stores Soundor owns per plugin instance), the generated `NativeMethods` trait (every configured method required, with its types, sync or async as declared; a config without methods needs no `impl`), `TaskContext` (the stores, typed `params` and `state`, `history`, `presets`, the processor's resources; neither `Send` nor kept past its call), `AsyncTaskContext` (owned and `Send`: the shared store, the resources, and `schedule()`, lazy, cancelled when dropped while queued, never interrupted once running), `soundor::unblock()`, `soundor::Error`, `soundor::types` (the config's native types), and `soundor::testing::TestController` with `TestHost`. `soundor::export!(PluginProcessor, PluginController)` exports a controller with the processor; `soundor::export!(PluginProcessor)` still exports a processor alone. `soundor init` scaffolds `lib/src/controller.rs` when the config declares methods, and names the processor `PluginProcessor`.
  - `@soundor/core`: `describeController()`, the controller descriptor both the Rust SDK and the runtime's generated code hold.
  - `@soundor/engine`: `soundor/processor/RustController.h` (`processor::RustController`, `ControllerServices`, `ControllerContract`) and `RustControllerAbi.h`, the bridge to a controller's C ABI, and generic `soundor:native` bindings (`js/RustMethods.h`) that check and convert values as the generated C++ bindings do, settle async methods' promises when the controller is pumped and run the context's microtasks after. `RustProcessor::nativeHandle()`.
  - `@soundor/juce-runtime`: the generated processor creates the Rust controller with the plugin instance (`rustController()`), backs it with the parameter editors, state store, History and presets, pumps it on the message thread through an `AsyncUpdater`, and shuts it down first; every editor installs its methods (`native::installController()`), ahead of `createNativeApi()`. `SoundorNative.h` holds the controller descriptor.

- [#331](https://github.com/soundor/soundor/pull/331) [`f28464c`](https://github.com/soundor/soundor/commit/f28464c9ef2dd445f1d6344197c93065dcc8a9cd) Thanks [@dm-balakin](https://github.com/dm-balakin)! - **Breaking:** the plugin's Rust processor and controller library now lives in `lib/`. Rename `native/` to `lib/`, update Cargo manifest paths in scripts and tooling, and run `soundor gen`. Legacy and ambiguous layouts produce a migration error without changing user files.

  Runtime authors must use `ctx.lib`, `LibraryBuildContext`, `LibraryBuildRequest`, and `LibraryArtifact` in place of the Rust crate's native-named context and types. Cargo options, processor/controller ABI, and the public `soundor:native` methods/events API are unchanged. Both JUCE and Web compile the same library for their targets.

### Patch Changes

- [#301](https://github.com/soundor/soundor/pull/301) [`523dacc`](https://github.com/soundor/soundor/commit/523dacc94f532d589600232df16e6b4fc7e0ef65) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Clean up lint warnings and update callback references after React commits, keeping installed listeners stable.

- [#307](https://github.com/soundor/soundor/pull/307) [`6c7e0d9`](https://github.com/soundor/soundor/commit/6c7e0d95081345fe00b21238c44325436755d45f) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add allocation instrumentation to the Rust processor testing harness and the scaffold's tests. Count allocator calls only while processing, with a required counting allocator so missing instrumentation cannot pass silently. Exercise the Rust SDK, native FFI, JUCE adapter and example processors; compare Orbit's real VST3 output with its WebAssembly build. Document the shared Rust processor lifecycle, generated config contract, Cargo dependencies, runtime boundaries, testing and migration.

  Reuse prepared WebAssembly parameter, transport and channel views during processing, including partial and oversized blocks. Preallocate the worklet's channel arrays and silence missing inputs without allocating fallback buffers. Unexpected WASM memory growth fails silently instead of rebuilding views in the callback. Browser publication messages still allocate; these checks do not claim a hard real-time guarantee.

- Updated dependencies [[`523dacc`](https://github.com/soundor/soundor/commit/523dacc94f532d589600232df16e6b4fc7e0ef65), [`78f82f2`](https://github.com/soundor/soundor/commit/78f82f2a881ce4c5e88208823acf34e83ffa114e), [`a718364`](https://github.com/soundor/soundor/commit/a718364b0d93b117d542629fec11458c6995021f), [`085d5a6`](https://github.com/soundor/soundor/commit/085d5a607fde5a76fb87986d90f49b350bc75c41), [`23162f7`](https://github.com/soundor/soundor/commit/23162f7bf06b592d48f129c3255bb5d2de47a856), [`c15667d`](https://github.com/soundor/soundor/commit/c15667dee72d1d70cb3bf8c19275791fd5fc93a6), [`bb8b0a0`](https://github.com/soundor/soundor/commit/bb8b0a051a150d6edb2ef1859fae66bc3169f09d), [`b7dbe5f`](https://github.com/soundor/soundor/commit/b7dbe5fa46dca1be9c82094ae2482a37610aa194), [`439c5f4`](https://github.com/soundor/soundor/commit/439c5f4355ba1656ac1c3b472ba93ff3fc701fb6), [`3f303a0`](https://github.com/soundor/soundor/commit/3f303a014274a3b23d2a406db3e3aae44128c253), [`84678d1`](https://github.com/soundor/soundor/commit/84678d157ca75d9cfa125d784c0ad07df3c7a5a6), [`d3fe0e2`](https://github.com/soundor/soundor/commit/d3fe0e284f82c13386d90c64803fb1e6475ab91e), [`ec9f9e7`](https://github.com/soundor/soundor/commit/ec9f9e734c75fe1b6622df88a8862a45aa8008bf), [`f28464c`](https://github.com/soundor/soundor/commit/f28464c9ef2dd445f1d6344197c93065dcc8a9cd)]:
  - @soundor/config@0.18.0
  - @soundor/core@0.18.0
  - @soundor/devtools-client@0.18.0
  - @soundor/devtools-server@0.18.0
  - @soundor/driver@0.18.0

## 0.17.1

### Patch Changes

- [#298](https://github.com/soundor/soundor/pull/298) [`582aeec`](https://github.com/soundor/soundor/commit/582aeec3a8191fc664d4a426dd295557918be8ee) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Publish all packages through npm trusted publishing with GitHub Actions OIDC.
- Updated dependencies [[`582aeec`](https://github.com/soundor/soundor/commit/582aeec3a8191fc664d4a426dd295557918be8ee)]:
  - @soundor/config@0.17.1
  - @soundor/core@0.17.1
  - @soundor/devtools-client@0.17.1
  - @soundor/devtools-server@0.17.1
  - @soundor/driver@0.17.1

## 0.17.0

### Minor Changes

- [#252](https://github.com/soundor/soundor/pull/252) [`3275981`](https://github.com/soundor/soundor/commit/32759813fd8c6ef0f59fa10f7d2c2dc6e2f291a3) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Double clicks: `soundor:ui` declares the `dblclick` event and `PointerEvent.detail` (which click of a series a `click` is, as the platform counts them), and `@soundor/react` nodes take `onDoubleClick` and `onDoubleClickCapture`. The test runtime counts a press as its `detail` says (1 by default) and fires `dblclick` after a second click; Testing Library adds `user.dblClick()` and `fireEvent.dblClick()`, and `user.pointer` presses take a `detail`. Soundor Driver adds `locator.dblclick()`, `pointer.dblclick()` and a `clickCount` option for `pointer.down()` and `pointer.click()` (`Input.dispatchPointer`'s `clickCount`), and `soundor driver dblclick`.

- [#256](https://github.com/soundor/soundor/pull/256) [`d5b9b16`](https://github.com/soundor/soundor/commit/d5b9b167c52bea1113785d84d62fb78e8409d06d) Thanks [@dm-balakin](https://github.com/dm-balakin)! - **Breaking:** runtimes and the CLI agree on a runtime API version. `RUNTIME_API_VERSION` (now 1) in `@soundor/config` is the version of what a runtime depends on of its host (the `Runtime` interface, `LifecycleContext`, the config it receives, the error protocol), independent of the package versions. `defineRuntime()` gives a runtime the version of the `@soundor/config` it is built with (`runtime.apiVersion`; a runtime without one implements 1), and `resolveRuntime()` refuses, with exit code 4 (`INCOMPATIBLE_RUNTIME`), one outside `MIN_RUNTIME_API_VERSION` to `RUNTIME_API_VERSION`, or one older than a config setting the project uses (`CONFIG_FEATURES`), naming its path. `soundor init`, `gen`, `dev`, `build` and `doctor` resolve every runtime they run before generating or bundling anything. `packages/config/runtime-api.json` records the contract, and a test fails when it changes, for the version to be raised if runtimes could notice.

  The config schema rejects properties it does not have (`unknown property 'mapping' in @soundor/config 0.17.0`) instead of dropping them, and `parseConfig()` refuses a project whose own `@soundor/config` is of another release line than the CLI's (`ConfigError` of kind `compatibility`).

  Errors are recognized across copies of the packages: `isSoundorError(value, code?)` checks a protocol every `SoundorError` carries (the brand `Symbol.for('soundor.error.v1')`, a string `code`, `issues`), and `isConfigError()` a `ConfigError`'s. `runPhase()` passes through, and `exitCodeFor()` classifies, an error a runtime threw from its own `@soundor/core`, where `instanceof` said no: a runtime's `ConfigError` or `EnvError` was wrapped as a `RuntimeError` with exit code 5. New: `RuntimeCompatibilityError` in core; `CONFIG_VERSION`, `RUNTIME_API_VERSION`, `MIN_RUNTIME_API_VERSION`, `CONFIG_FEATURES`, `HOST_RUNTIME_API`, `checkRuntimeCompatibility()`, `runtimeApiVersion()`, `checkProjectConfigVersion()`, `projectConfigVersion()` and `sameReleaseLine()` in config.

  `@soundor/runtime-sdk` re-exports all of `@soundor/config` and `@soundor/core`, and is the one Soundor package a runtime depends on; its new `@soundor/runtime-sdk/client` entry has what a runtime's client code needs without Node (core's springs). `defineSoundorConfig()` returns a `SoundorConfig` instead of the literal type of what it is given, so a project's config type names only `@soundor/config`, not its runtimes' packages (which a `composite` project, as `create-soundor-app` makes, could not name). Parameter types for the UI come from `soundor gen`, as before. `soundor` and `@soundor/runtime-sdk` depend on `@soundor/config` instead of declaring it a peer: both run its code.

  `soundor gen`, `init` and `doctor` exit when they fail: their progress spinner kept the process running after the error was printed.

- [#289](https://github.com/soundor/soundor/pull/289) [`67ffaac`](https://github.com/soundor/soundor/commit/67ffaacba3038901877563c40af773dfc2122e7d) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add soundor:env with explicit, typed, readonly public configuration values and DEV/PROD/MODE built-ins. Embed values in the shared UI bundle, resolve the same module for web host code, and support isolated configuration in the test runtime. No process environment is exposed implicitly.

- [#275](https://github.com/soundor/soundor/pull/275) [`258c891`](https://github.com/soundor/soundor/commit/258c8911cecc26d26e22c7bcc0d78d52dde66fc7) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Runtime packages now declare supported Soundor CLI versions through a required `soundor` peer dependency. Both first-party runtimes use a caret range matching their regular `@soundor/runtime-sdk` dependency; the SDK and CLI share the fixed package version. Before 1.0, this supports the current minor and its patches. Runtime providers own the supported range, and package managers handle peer mismatches without an additional CLI compatibility check.

  Remove the numeric `Runtime.apiVersion` and `ResolvedRuntime.apiVersion`, runtime API version constants and contract record, config-feature version gates, compatibility helpers, and `RuntimeCompatibilityError` with its dedicated error codes. Third-party runtimes should remove those imports and fields, keep the SDK as a regular dependency, and declare the supported CLI range in `peerDependencies.soundor`. The existing project config release-line check and cross-copy error protocol remain.

### Patch Changes

- [#285](https://github.com/soundor/soundor/pull/285) [`3a778e2`](https://github.com/soundor/soundor/commit/3a778e22214860be850efe603802a955f3fdda52) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Stop Windows UI rebuild loops by ignoring filesystem events without filenames and normalizing Windows separators and directory casing before filtering generated output.
- Updated dependencies [[`3275981`](https://github.com/soundor/soundor/commit/32759813fd8c6ef0f59fa10f7d2c2dc6e2f291a3), [`a54e1da`](https://github.com/soundor/soundor/commit/a54e1da16a93c0097789c8e9e974632f4b12526c), [`496fe62`](https://github.com/soundor/soundor/commit/496fe623abcf179945db4b2df92f873cf399bb87), [`0354f73`](https://github.com/soundor/soundor/commit/0354f730087bbde8a2f7ad34ca7595c373c20c20), [`27a3303`](https://github.com/soundor/soundor/commit/27a330313c40db624ef897111a5ab37a320f3ea0), [`13da21d`](https://github.com/soundor/soundor/commit/13da21de509056defdaf7959cc7af78eb345ea1a), [`d5b9b16`](https://github.com/soundor/soundor/commit/d5b9b167c52bea1113785d84d62fb78e8409d06d), [`d5b9b16`](https://github.com/soundor/soundor/commit/d5b9b167c52bea1113785d84d62fb78e8409d06d), [`553d8c4`](https://github.com/soundor/soundor/commit/553d8c430aab0c1e620dbd9d9be62448d41982f6), [`14b7be0`](https://github.com/soundor/soundor/commit/14b7be04bb0262c6359ba08aac2087315f72d71f), [`67ffaac`](https://github.com/soundor/soundor/commit/67ffaacba3038901877563c40af773dfc2122e7d), [`258c891`](https://github.com/soundor/soundor/commit/258c8911cecc26d26e22c7bcc0d78d52dde66fc7), [`61798d1`](https://github.com/soundor/soundor/commit/61798d199d6c5a32d1f8118fba4f67184e280a13), [`553076d`](https://github.com/soundor/soundor/commit/553076ddfee437804ce959495d967af8bd9081d2), [`6cfc628`](https://github.com/soundor/soundor/commit/6cfc628494cb431a15d98f50d7c696ba19a89348)]:
  - @soundor/driver@0.17.0
  - @soundor/devtools-server@0.17.0
  - @soundor/config@0.17.0
  - @soundor/core@0.17.0
  - @soundor/devtools-client@0.17.0

## 0.16.0

### Minor Changes

- [#215](https://github.com/soundor/soundor/pull/215) [`9e4c0ef`](https://github.com/soundor/soundor/commit/9e4c0efa87a2743965921a0590c61f161faeb0bf) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add `soundor build juce --debug`: a one-shot Debug build with DevTools and the UI embedded, for tests, in `.soundor/debug/juce/<format>/`. Add `--out <dir>` to `soundor build`, for releases and debug builds.

- [#208](https://github.com/soundor/soundor/pull/208) [`01bf473`](https://github.com/soundor/soundor/commit/01bf473f0fe1d09678b8e34073d7642fbbbb95e7) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Enable the `soundor` package condition when bundling plugin UIs and running
  Soundor Vitest tests, including external dependencies. Libraries can expose
  Soundor and DOM implementations through the same import, with the Soundor
  entry selected for both JUCE and the web runtime. New projects include
  `customConditions: ["soundor"]` in their UI tsconfig; existing and manually
  created projects should add it to select matching TypeScript declarations.

### Patch Changes

- Updated dependencies [[`c6a011f`](https://github.com/soundor/soundor/commit/c6a011f5fcbe805ff4c9def2b1d3ddc50dadf89b), [`7fb3f13`](https://github.com/soundor/soundor/commit/7fb3f13f2e3435764e0c5c84ba0b2c44ef805430), [`cdbebe4`](https://github.com/soundor/soundor/commit/cdbebe4624eeb57c7d7be6840d10e2a0e92b2cf7)]:
  - @soundor/driver@0.16.0
  - @soundor/core@0.16.0
  - @soundor/devtools-client@0.16.0
  - @soundor/devtools-server@0.16.0

## 0.15.0

### Minor Changes

- [#194](https://github.com/soundor/soundor/pull/194) [`003c103`](https://github.com/soundor/soundor/commit/003c103191eb4bec37df0aca7bad4d8e3fbdbe4f) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Support bundled SVG assets through Image with the existing content-addressed asset IDs and TypeScript imports. Native images cache bounded Skia SVG documents and render them at the effective physical resolution; Web images use the browser's image decoder. Preserve Image sizing and resize modes, with documented SVG intrinsic-size fallbacks and compatibility limits.

### Patch Changes

- Updated dependencies [[`128f5fe`](https://github.com/soundor/soundor/commit/128f5fe2cf4d999ecaa34de8c5584e2acca44900)]:
  - @soundor/devtools-client@0.15.0
  - @soundor/core@0.15.0
  - @soundor/devtools-server@0.15.0
  - @soundor/driver@0.15.0

## 0.14.0

### Minor Changes

- [#180](https://github.com/soundor/soundor/pull/180) [`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Projects no longer list `@soundor/core`. It is now a regular dependency of every package that imports it, instead of a peer dependency the project had to provide. The CLI, `@soundor/config`, `@soundor/runtime-sdk` and `@soundor/vitest` pin the exact version their release group shares, so a project still gets one copy. The runtimes take it with a caret range. New projects from `create-soundor-app` no longer include it, and an existing project can remove it from its `devDependencies`.

- [#178](https://github.com/soundor/soundor/pull/178) [`ce7601d`](https://github.com/soundor/soundor/commit/ce7601d1df6706d3d8957bb84247fee5568bd530) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Bring your own fonts: `import inter from './Inter.ttf'` (or `.otf`) bundles a font file, and `registerFont('Inter', inter, { weight, style })` from `soundor:ui` makes it a face of a family, as CSS's `@font-face` does. Text whose `fontFamily` is a registered family is set in its closest registered face (bold and italic synthesized where none is), in views and canvases alike; text already shown is laid out again. In the web runtime, a `fontFamily` is now quoted in CSS (unless generic), so names such as `'Inter 18pt'` work as they do natively.

- [#180](https://github.com/soundor/soundor/pull/180) [`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba) Thanks [@dm-balakin](https://github.com/dm-balakin)! - The runtime that runs another form of the UI now makes that form itself. The CLI bundles the UI into one ES module, `bundle.mjs`. The JUCE runtime lowers it for Hermes with the `toNativeModule()` of the engine it links (`@soundor/engine/native-module`), into `.soundor/cache/juce/ui-debug` or `ui-release`. The lowering therefore always matches the plugin's engine, and a web-only project no longer pays for it.

  `ctx.ui.entry` is removed. In `soundor dev`, `ctx.ui.live` gains `onBuild(listener)` and `sourceMap(file, mapFile)`, so that a runtime can remake its form after every build and have its stack frames mapped. `@soundor/core` no longer depends on `@soundor/engine` and no longer exports `toNativeModule()`; import it from `@soundor/engine/native-module`.

### Patch Changes

- [#181](https://github.com/soundor/soundor/pull/181) [`46ea13f`](https://github.com/soundor/soundor/commit/46ea13fb35cf61f1fea9bd8a11f753ec4444fba0) Thanks [@dm-balakin](https://github.com/dm-balakin)! - The UI bundle ships only the images and fonts its code still uses after tree shaking: a library's font helper that the plugin never calls no longer adds its files to the plugin.
- Updated dependencies [[`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba), [`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba), [`4588cca`](https://github.com/soundor/soundor/commit/4588cca3b50a0db869c8d220408dbf23c477f1f2), [`ce7601d`](https://github.com/soundor/soundor/commit/ce7601d1df6706d3d8957bb84247fee5568bd530), [`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba), [`2e2080e`](https://github.com/soundor/soundor/commit/2e2080e0e9d45ba6fa77a0ff4449b6db51fe25e8)]:
  - @soundor/core@0.14.0
  - @soundor/devtools-client@0.14.0
  - @soundor/devtools-server@0.14.0
  - @soundor/driver@0.14.0

## 0.13.0

### Minor Changes

- [#164](https://github.com/soundor/soundor/pull/164) [`f75bc0c`](https://github.com/soundor/soundor/commit/f75bc0ca9a76077bdb9b3e7df28cfa5d3b3dbab2) Thanks [@dm-balakin](https://github.com/dm-balakin)! - DevTools targets have no owner any more: every signed-in client (dashboard tabs, Soundor Driver, `soundor driver`) reads, highlights, picks, records and sends input at the same time, as several mice and keyboards share one computer. The engine keeps each client's synthetic pointer, held keys, highlight and picker apart, draws every client's highlight, and releases only a client's own input when it disconnects. The performance recording is shared and stops once every client that started it is gone.

  Breaking: the protocol is version 2. `Control.acquire`/`Control.release`, `LEASE_BUSY`/`LEASE_REQUIRED` and targets' `controller` are removed; runtime requests carry the sending `client`, and `resetControl` is replaced by `clientGone`. The Driver drops `acquireControl()`, `releaseControl()` and `hasControl`; the dashboard drops **Request control**; `soundor driver` exit code 6 now means the target is busy.

### Patch Changes

- Updated dependencies [[`57cfc9f`](https://github.com/soundor/soundor/commit/57cfc9f06bc074ae820def8797a4f44963711f79), [`f75bc0c`](https://github.com/soundor/soundor/commit/f75bc0ca9a76077bdb9b3e7df28cfa5d3b3dbab2)]:
  - @soundor/devtools-client@0.13.0
  - @soundor/devtools-server@0.13.0
  - @soundor/driver@0.13.0

## 0.12.0

### Minor Changes

- [#163](https://github.com/soundor/soundor/pull/163) [`e02159e`](https://github.com/soundor/soundor/commit/e02159eb8eb68a989a4dea8f405efdca9dff7798) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Soundor Driver screenshots: the engine captures its view as it renders it, as PNG (`capture` capability, `Capture.screenshot`), and the JUCE bridge uploads it to the DevTools server as binary, which keeps it as a short-lived capture clients read with their session cookie (bounded in size, number and lifetime). `driver.screenshot()`, `locator.screenshot()` and `soundor driver screenshot <path>` save it; DevTools previews and downloads it. Locators gain `waitFor()` and `isVisible()`, and a missing debug ID lists the ones there are.

- [#162](https://github.com/soundor/soundor/pull/162) [`3fe72a1`](https://github.com/soundor/soundor/commit/3fe72a188cef8f8a1b9eb4f49d5107cf41ac4096) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Soundor Driver input: the engine dispatches synthetic pointer, wheel and keyboard input through its own hit testing, capture and event dispatch (`input` capability; `Input.dispatchPointer`, `dispatchWheel`, `dispatchKey`, `typeText`, `focus` and `UI.hitTest` in the DevTools protocol), on a pointer of its own, and releases whatever it holds when control is released, the client goes or the UI reloads. `@soundor/driver` adds `pointer`, `keyboard`, control leases and locator actions (`click`, `hover`, `drag`, `dragTo`, `scroll`, `focus`, `press`, `type`) that wait until a node is actionable; `soundor driver` adds `click`, `hover`, `focus`, `move`, `drag`, `scroll`, `key` and `type`; DevTools offers Click, Hover and Focus on the selected node. The engine decodes runtime commands itself, and `Surface::key(input, typed)` is the shared key entry of the JUCE editor and synthetic input.

- [#160](https://github.com/soundor/soundor/pull/160) [`4974b0d`](https://github.com/soundor/soundor/commit/4974b0dfbd49c801d61488341d6fa05d4c8b3239) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Soundor Driver: `@soundor/driver` connects to a running plugin's DevTools session as a control client and inspects its native UI (targets, the node tree, node details, and lazy locators by debug ID, role or text); `soundor driver targets|tree|inspect` does the same from the command line, with `--json` output and stable exit codes. Components take a `debugId` prop (`node.debugId` in `soundor:ui`), which DevTools shows and the Driver finds nodes by.

### Patch Changes

- Updated dependencies [[`e02159e`](https://github.com/soundor/soundor/commit/e02159eb8eb68a989a4dea8f405efdca9dff7798), [`3fe72a1`](https://github.com/soundor/soundor/commit/3fe72a188cef8f8a1b9eb4f49d5107cf41ac4096), [`4974b0d`](https://github.com/soundor/soundor/commit/4974b0dfbd49c801d61488341d6fa05d4c8b3239)]:
  - @soundor/driver@0.12.0
  - @soundor/devtools-server@0.12.0
  - @soundor/devtools-client@0.12.0

## 0.11.0

### Minor Changes

- [#148](https://github.com/soundor/soundor/pull/148) [`c47273e`](https://github.com/soundor/soundor/commit/c47273ed269a5c0b5e50da5ad8a222708b46743d) Thanks [@dm-balakin](https://github.com/dm-balakin)! - New projects pin every Soundor package to the exact version `create-soundor-app` was released with, instead of `latest`: before 1.0 a minor release can change APIs, so a project changes Soundor versions only when it is upgraded. React, TypeScript and the Node and React types take the ranges Soundor is built and tested with.

  Soundor supports pnpm and npm. `create-soundor-app` no longer offers Yarn or bun, and prints `npm run dev` rather than `npm dev` for npm projects; `soundor doctor` warns when it runs under another package manager.

### Patch Changes

- Updated dependencies []:
  - @soundor/devtools-client@0.11.0
  - @soundor/devtools-server@0.11.0

## 0.10.1

### Patch Changes

- [#145](https://github.com/soundor/soundor/pull/145) [`1d7eb63`](https://github.com/soundor/soundor/commit/1d7eb63cc2c4288f05e34bdfe7cfc5af82ad4ccf) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Centralize guides and package references in `docs/`, with a documentation index,
  page navigation, and package README links that also work on npm. Add a project
  README and guides covering the idea, architecture, getting started, project
  lifecycle, parameters, and contributing.
- Updated dependencies [[`1d7eb63`](https://github.com/soundor/soundor/commit/1d7eb63cc2c4288f05e34bdfe7cfc5af82ad4ccf)]:
  - @soundor/devtools-client@0.10.1
  - @soundor/devtools-server@0.10.1

## 0.10.0

### Minor Changes

- [#138](https://github.com/soundor/soundor/pull/138) [`66210eb`](https://github.com/soundor/soundor/commit/66210eb00891368cf45d3847acb73e144d75c9d6) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `soundor dev` prints a summary when the runtime is ready (plugin, DevTools URL, and what the runtime adds), collapses the native build output into one progress line in a terminal (all of it is kept in `.soundor/dev/build.log`), and takes shortcuts: `o` opens DevTools signed in, `c` copies a signed-in link, `u` shows the summary again, `q` quits. Runtimes report readiness and add shortcuts through the new `ctx.session`; the JUCE runtime adds `s` to relaunch the Standalone, the Web runtime `w` to open the Web host.

### Patch Changes

- Updated dependencies []:
  - @soundor/devtools-client@0.10.0
  - @soundor/devtools-server@0.10.0

## 0.9.0

### Patch Changes

- [#137](https://github.com/soundor/soundor/pull/137) [`ee85daa`](https://github.com/soundor/soundor/commit/ee85daa245fe5f71f2faa90eafb9b86db2f6026a) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Name the source repository and directory in every package, so npm links each package to its source and resolves its README's relative links.
- Updated dependencies [[`b1f3261`](https://github.com/soundor/soundor/commit/b1f3261faf930dcd6640926d7bb8180a7147adb8), [`ee85daa`](https://github.com/soundor/soundor/commit/ee85daa245fe5f71f2faa90eafb9b86db2f6026a), [`421939b`](https://github.com/soundor/soundor/commit/421939b530a63aaaf15d0761a4b3c553279efd70)]:
  - @soundor/devtools-server@0.9.0
  - @soundor/devtools-client@0.9.0

## 0.8.0

### Minor Changes

- [#125](https://github.com/soundor/soundor/pull/125) [`5cc746e`](https://github.com/soundor/soundor/commit/5cc746efe099cf5ed5b564647168a1f2def020f2) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add the browser DevTools Elements inspector, live native node details, two-way picker selection, explicit target control, and filtered application console. Handle target switching, runtime reload, and WebSocket reconnection safely.

- [#127](https://github.com/soundor/soundor/pull/127) [`640fca8`](https://github.com/soundor/soundor/commit/640fca812d39e560c89494b645169e0377df7e32) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Expose real native animation snapshots and bounded lifecycle events, plus explicit performance recording of measured UI tick, layout, raster, frame and compositor work. Add animation and performance panels to DevTools with controller-only recording and safe reload/disconnect cleanup. Keep inspection read-only where reconciler-safe property overrides or source metadata are unavailable.

- [#122](https://github.com/soundor/soundor/pull/122) [`04ff5cf`](https://github.com/soundor/soundor/commit/04ff5cf759658cfda0f0ee748f1287fd29ee9848) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add optional runtime DevTools capabilities, development connection context and validated platform-specific user settings. Discover DevTools support before development without requiring existing runtimes to change.

- [#123](https://github.com/soundor/soundor/pull/123) [`7e5e33b`](https://github.com/soundor/soundor/commit/7e5e33b8aee3b3fbd07b1edab105b6d319843c7f) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add the versioned Soundor Debug Protocol and local development session server with browser WebSockets, authenticated asynchronous native IPC, instance routing, generation validation, control leases, bounded subscriptions and lifecycle cleanup.

### Patch Changes

- [#128](https://github.com/soundor/soundor/pull/128) [`5ec0815`](https://github.com/soundor/soundor/commit/5ec081578c4f7667e5942cf1ca8e8c8d172a195a) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Extract DevTools into an independent Node server and TypeScript/Vite application,
  preserving the shared protocol and dashboard behavior. Add secure optional static
  serving, headless operation, reusable simulated runtimes and scenarios, standalone
  frontend development, browser E2E coverage and packed-consumer validation.

  Allow Vite development to attach to an existing loopback backend through an
  explicit CLI Origin opt-in, retaining normal browser authentication and backend
  ownership. Derive simulated tree roots from the current fixture nodes.

  Separate browser session handling, protocol state, and dashboard rendering into
  focused client modules. Cover state transitions with DOM-independent tests,
  model cancellable simulated operations without error side effects, and isolate
  frontend development tests with ephemeral ports. Canonicalize localhost browser
  bootstrap links onto the explicitly trusted loopback origin.

- [#124](https://github.com/soundor/soundor/pull/124) [`2807b91`](https://github.com/soundor/soundor/commit/2807b91593c45278d51e400892b399368e1f55c7) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Connect JUCE development Standalones to the designated DevTools session through asynchronous authenticated IPC. Inspect actual native nodes, styles, layout, accessibility and focus, render independent CPU/GPU highlight layers, and intercept native picker clicks safely across disconnects and reloads. Exclude the bridge from production builds.
- Updated dependencies [[`5ec0815`](https://github.com/soundor/soundor/commit/5ec081578c4f7667e5942cf1ca8e8c8d172a195a)]:
  - @soundor/devtools-server@0.8.0
  - @soundor/devtools-client@0.8.0

## 0.7.0

### Minor Changes

- [#108](https://github.com/soundor/soundor/pull/108) [`b1a2699`](https://github.com/soundor/soundor/commit/b1a269977dccf753785bbbe123a799a4ec783e4b) Thanks [@dm-balakin](https://github.com/dm-balakin)! - **Breaking:** natively, plugin UIs run on Hermes, not QuickJS-NG: `eval()` and `new Function()` throw, private class members and `let`/`const` follow the lowered semantics below, and a call into JavaScript that runs past `juceRuntime({ timeLimit })` (5 s by default) is stopped. Runtime authors: the CLI's UI bundle context gains `ctx.ui.module` (the ES module) beside `ctx.ui.entry` (now the native CommonJS form), and the native `RuntimeStatistics` counts collections instead of allocations. The `soundor` CLI needs Node `^22.18.0 || >=24.11.0` (Babel 8).

  The JUCE runtime runs JavaScript on Hermes's interpreter instead of QuickJS-NG (no JIT; no Static Hermes). A built plugin embeds its UI bundle as Hermes bytecode, compiled at build time by the `hermesc` of the same pinned Hermes build, and links the VM without its compiler; `soundor dev` evaluates source and reloads as before. Hermes is built from source once per machine into Soundor's cache (several minutes, the first time), with hidden symbols, and its heap running out is an error instead of an abort: such a context fails from then on and is recreated on reload.

  Hermes has no ES modules, so the CLI now writes the UI bundle twice: `bundle.mjs`, the ES module the Web runtime loads (`ctx.ui.module`), and `bundle.js` (`ctx.ui.entry`), the native runtime's form: a CommonJS module function with classes, block scoping, private members, async functions and async generators lowered for Hermes by `@soundor/core`'s new `toNativeModule()` (Babel). `soundor:*` imports and application sources are unchanged.

  What changes for plugin code running natively: `eval()` and the `Function` constructors throw (a built plugin has no compiler, and `soundor dev` fails the same way), so code generated at run time needs a form made at build time; private class members are properties keyed by symbols of their own (fast, but visible to `Object.getOwnPropertySymbols()`, and unchecked: reading one on another object gives `undefined`); `let`/`const` have no temporal dead zone (reading one before its declaration gives `undefined`); on Linux, `localeCompare` and dates' `toLocaleString()` ignore the user's locale. Each context has a garbage-collector thread of Hermes's own. Built-ins Hermes lacks (FinalizationRegistry, `queueMicrotask`, Set methods, iterator helpers, `toSorted`, `Promise.withResolvers`, ArrayBuffer `transfer()`...) are provided; Atomics, SharedArrayBuffer, Float16Array, `Intl` and `Symbol.species` are not. `RuntimeStatistics` counts garbage collections (`collections`) instead of allocator calls.

  A UI script that never returns no longer freezes the host for good: `juceRuntime({ timeLimit })` (milliseconds, 5000 by default; `false`: none) bounds each call into JavaScript (a frame, an event, a timer, startup), past which the engine stops it with a `TimeoutError` JavaScript cannot catch; the error is logged and the context fails from then on, until the editor is opened again or `soundor dev` reloads. Natively, `RuntimeOptions::timeLimit` and `js::TimeLimitScope`. Native objects behind `soundor:native` handles are released on the UI thread, at the next tick after the collector finalizes their handles, never on the collector's own thread.

## 0.6.0

### Minor Changes

- [#90](https://github.com/soundor/soundor/pull/90) [`03473ec`](https://github.com/soundor/soundor/commit/03473ecbc080bc73d45a92151970b76bbb35594f) Thanks [@dm-balakin](https://github.com/dm-balakin)! - macOS code signing. A config can name a signing identity (`signing.macos.identity`), and `SOUNDOR_MACOS_SIGNING_IDENTITY` overrides it; without either, binaries are signed ad-hoc. Runtimes receive the resolved settings as `ctx.signing`, and `soundor doctor` reports the identity and where it came from. The JUCE runtime now signs every macOS bundle as the last build step and verifies the signature, so the VST3 `moduleinfo.json` no longer invalidates it ([#63](https://github.com/soundor/soundor/issues/63)); with a real identity it adds the hardened runtime and a secure timestamp, which notarization requires. `soundor dev` always signs ad-hoc. The JUCE runtime builds with Ninja on macOS and Linux (an existing build tree from another generator is recreated) and keeps Visual Studio on Windows.

## 0.5.0

No changes in this release.

## 0.4.0

No changes in this release.

## 0.3.0

### Minor Changes

- [#47](https://github.com/soundor/soundor/pull/47) [`213d6c1`](https://github.com/soundor/soundor/commit/213d6c133b1872b0a6f1f26f637ad07d262800e4) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `soundor dev` reloads the plugin UI on every change.

  - The CLI watches the project and rebuilds the UI bundle; each successful build writes a `build-id` last. A failed build is reported and the last good build keeps running.
  - The JUCE debug build loads the UI from disk instead of embedding it and replaces its JavaScript runtime with a fresh one on each new build (new native `DevSession`).
  - The plugin's console output and uncaught errors are written to `.soundor/dev/ui.log` and shown in the `soundor dev` terminal, with stack frames source-mapped to the TypeScript.
  - `UiBundleContext` gains `live` (with `logFile`) in dev: runtimes should load and reload such a UI rather than embed it.

- [#46](https://github.com/soundor/soundor/pull/46) [`f925d60`](https://github.com/soundor/soundor/commit/f925d60fcccd3adb98aeec89532eb5d35d51ed53) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Plugin UIs are TypeScript/TSX bundled with tsdown and run inside the plugin.

  - `soundor dev`/`soundor build` bundle `src/main.tsx` (or `.ts`/`.jsx`/`.js`) into one ES module: npm packages inlined, `soundor:*` imports kept, minified for production, source-mapped for development. Image imports (`.png`, `.jpg`, `.jpeg`, `.webp`) become content-addressed assets. Runtimes receive the bundle as `ctx.ui`.
  - The JUCE runtime compiles the bundle into the plugin and the editor's runtime evaluates it.
  - `soundor gen` emits `globals.d.ts`: the Web APIs the runtime provides and image imports, for `lib: ["ES2023"]` projects without DOM types.
  - New projects get a `src/main.ts` entry and runtime-appropriate tsconfigs.

- [#51](https://github.com/soundor/soundor/pull/51) [`f0218c6`](https://github.com/soundor/soundor/commit/f0218c64b04ce2f091229891a9a91493914f5efe) Thanks [@dm-balakin](https://github.com/dm-balakin)! - New projects and the example are React apps, and two Soundor plugins are proven to coexist in one host.

  - `create-soundor-app` scaffolds a `src/main.tsx` React UI with `@soundor/react`.
  - `soundor:host`'s `snapshot()` returns the same object until the host state changes, so it works with `useSyncExternalStore(subscribe, snapshot)`. A fresh object on every call made React loop.
  - A coexistence test loads two copies of the runtime under different ABI namespaces into one process and runs them interleaved, unloading and reloading them. A JUCE host test does the same with two real VST3s and their editors.

- [#50](https://github.com/soundor/soundor/pull/50) [`b2565bd`](https://github.com/soundor/soundor/commit/b2565bd3ed572c5e0460a52df1cb515c09e77e06) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `@soundor/react`: React for plugin UIs, rendering into the plugin view.

  - A react-reconciler renderer for `soundor:ui`: `render()`, `createRoot()`, `flushSync()`.
  - React Native–style components: `View`, `Text` (strings and nested `<Text>` flattened), `Image`, `ScrollView` (`contentContainerStyle`), `TextInput` (`value`/`onChangeText`, `onSubmitEditing`), `Pressable` (state-dependent `style` and `children`), with Web-style event props and capture variants.
  - `StyleSheet`, style arrays, and hooks: `useParameter()` and `useAnimationFrame()`.
  - `@soundor/core` ships the project-independent runtime declarations (`@soundor/core/runtime/ui.d.ts`, `globals.d.ts`) for packages written against `soundor:ui`.
  - **Breaking:** the previous `@soundor/react` (hooks over the WebView bridge) is replaced entirely.

- [#45](https://github.com/soundor/soundor/pull/45) [`22cfe24`](https://github.com/soundor/soundor/commit/22cfe242f3c01ded81b30ff26c997944afbbe5d4) Thanks [@dm-balakin](https://github.com/dm-balakin)! - The plugin's JavaScript runtime gets a Web-compatible platform layer and the `soundor:host`, `soundor:storage` and `soundor:fs` modules.

  - Globals: `self`, `console`, timers, `queueMicrotask`, `reportError`, `performance`, `Event`/`EventTarget`/`CustomEvent`, `AbortController`/`AbortSignal`, `TextEncoder`/`TextDecoder`, `URL`/`URLSearchParams` (ada), `atob`/`btoa`, `DOMException`, `structuredClone`, `crypto.getRandomValues`/`randomUUID`, and `fetch` with `Headers`/`Request`/`Response`/`Blob`/`File`/`FormData`. Blocking work is asynchronous and settles on the UI thread.
  - `soundor:host` (plugin identity, audio setup, transport), `soundor:storage` (persistent JSON key/value storage) and `soundor:fs` (atomic file access confined to the plugin's data directory). `soundor gen` emits their declarations in `platform.d.ts`.
  - **Breaking:** the generated JUCE processor implements `processBlock()` to capture the host transport; plugin processors implement `process()` (same signature) instead.

- [#49](https://github.com/soundor/soundor/pull/49) [`48b126c`](https://github.com/soundor/soundor/commit/48b126c2b37514bb3102db5e9717b0f3c36851bd) Thanks [@dm-balakin](https://github.com/dm-balakin)! - The plugin view is drawn: a Skia renderer and the UI primitives.

  - Skia (m144) is built from source at a pinned commit, CPU-only (no GPU, PDF, SVG, ICU or HarfBuzz), once per machine into Soundor's cache directory. It needs git, Python 3 and ninja, which `soundor doctor` now checks. Its symbols stay hidden inside each plugin.
  - `soundor:ui` draws backgrounds, borders, per-corner radii, opacity, clipping, text in the platform's fonts (with fallback), images, scroll views and text inputs. Styles take CSS colors (`color`, `backgroundColor`, `borderColor`), `borderRadius`, `opacity` and `resizeMode`.
  - New primitives: `createImage()`, `createScrollView()`, `createTextInput()` (editing, selection and clipboard as default actions; `input`/`change` events; UTF-16 indices), `pressable()`, `clipboard`, and global `requestAnimationFrame`/`cancelAnimationFrame`.
  - The JUCE editor renders the UI into its view, repainting only when it changed, and uses the system clipboard.
  - The symbol check now also fails on Objective-C classes compiled into a binary (Apple platforms).
  - **Breaking:** `ui::TextMeasurer` is replaced by `ui::TextEngine`; `RuntimeHost::Options::textMeasurer` is now `textEngine` and defaults to the renderer's fonts.

- [#44](https://github.com/soundor/soundor/pull/44) [`9e54964`](https://github.com/soundor/soundor/commit/9e549648cc02a34e4e4e6c6c02713cf73089a656) Thanks [@dm-balakin](https://github.com/dm-balakin)! - **Breaking:** parameters reach JavaScript through `soundor:parameters`, the plugin view hosts Soundor's JavaScript runtime, and the WebView-era UI stack is removed.

  - `soundor:parameters` exposes every config parameter as a typed object (`get`, `set`, `subscribe`, `beginGesture`/`endGesture`, `info`), backed directly by the JUCE `AudioProcessorValueTreeState`. Changes from the audio thread reach subscribers on the UI thread through lock-free flags. `soundor gen` emits its declaration as `parameters.d.ts` (`soundor.d.ts` references both module declarations); `parameters.ts`/`parameters.json` are no longer generated.
  - JUCE plugins now build the Soundor runtime (QuickJS-NG, fetched at a pinned revision) into the plugin under a per-plugin ABI namespace. Each editor hosts a runtime, and processors supply `soundor:native` by overriding `createNativeApi()`.
  - Removed: the `@soundor/bridge` and `@soundor/react` packages, the CLI's Vite UI build and dev server, `virtual:soundor/bridge`, the runtime contract's `bridgeModule()` and `dev.ui`/`build.ui` contexts, the example and template DOM UI, and the parameter `onChange` field.

- [#48](https://github.com/soundor/soundor/pull/48) [`1a6e00b`](https://github.com/soundor/soundor/commit/1a6e00b1dca06f87af6c05854c90c0e32ad6e43f) Thanks [@dm-balakin](https://github.com/dm-balakin)! - New `soundor:ui` module: the plugin view as a tree of nodes with flexbox layout and DOM-style input events.

  - `root`, `createView()`, `createText()`: `UiNode`s are `EventTarget`s with `appendChild`/`insertBefore`/`removeChild`, a React Native–style `style` (flexbox, spacing shorthands, percentages, absolute positioning, gaps, `pointerEvents`, text properties), `layout` and `getBoundingClientRect()`.
  - Layout by Yoga v3.2.1, pinned and built privately with hidden symbols.
  - Normalized input: pointer capture, hover enter/leave, clicks, wheel, keyboard, text input and focus with Tab navigation. Delivered as `PointerEvent`, `WheelEvent`, `KeyboardEvent`, `FocusEvent` and `InputEvent`, which capture and bubble along the tree.
  - `EventTarget` events now run capture, target and bubble phases when targets form a tree; `stopPropagation()` and `composedPath()` behave as on the Web.
  - The JUCE editor sizes the view's surface and forwards mouse, wheel and keyboard input; unhandled keys and wheel input go on to the host.
  - `soundor gen` emits `ui.d.ts` with the module's types.

## 0.2.0

### Minor Changes

- [#35](https://github.com/soundor/soundor/pull/35) [`ec62e01`](https://github.com/soundor/soundor/commit/ec62e0126943002e956f30d094385b11bab46c53) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Initial release

### Patch Changes

- [#37](https://github.com/soundor/soundor/pull/37) [`1ea0c8d`](https://github.com/soundor/soundor/commit/1ea0c8d61333253e4495bebc24be39812ebf9ba5) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Added package README files

## 0.1.0

### Minor Changes

- [#29](https://github.com/soundor/soundor/pull/29) [`f34ed1d`](https://github.com/soundor/soundor/commit/f34ed1deecec653a6d67ffe9c47c5357055d5d4b) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Initial release
