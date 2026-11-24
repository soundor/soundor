# @soundor/web-runtime

## 0.16.0

### Minor Changes

- [#374](https://github.com/soundor/soundor/pull/374) [`453d4fe`](https://github.com/soundor/soundor/commit/453d4fe5661821ff20aebed3d6267980dba71b34) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add `KeyboardEvent.code`, the physical key (`KeyS`, `Digit1`), in every runtime, so shortcuts such as Option+S on macOS or Shift+1 match whatever the key types. Natively it comes from the scan code, virtual key code or X11 keycode; Soundor Driver's keys and `user.keyboard` have the US key that types them.

  Add `accessibilityKeyShortcuts` (`accessibility.keyShortcuts`), the shortcuts that act on an element as `aria-keyshortcuts` writes them: `aria-keyshortcuts` on the web, UI Automation's `AcceleratorKey`, AT-SPI's `keyshortcuts` attribute, and the help text on macOS and iOS.

  Add `announce(message, { priority })` to `soundor:ui`, for a screen reader to speak what an action did: an ARIA live region on the web, UI Automation notification events, AT-SPI `object:announcement`, and AppKit's and UIKit's announcement notifications. `testView.announcements()` lists them in tests.

### Patch Changes

- Updated dependencies [[`8282460`](https://github.com/soundor/soundor/commit/82824608da3c6749103f91f23f23a5def5224bd2), [`e151fd8`](https://github.com/soundor/soundor/commit/e151fd8d9050c572904e212d6ee4610d976af1c4), [`2c5b9a4`](https://github.com/soundor/soundor/commit/2c5b9a45444421085bb3ef66613a0c5560e42ad5), [`2526d5f`](https://github.com/soundor/soundor/commit/2526d5fa3e3653f4ed82d9f10308cbf97dc632bc), [`9ee70c5`](https://github.com/soundor/soundor/commit/9ee70c51428c98939957f3f2c96e458a32cbc141), [`3e6ba0d`](https://github.com/soundor/soundor/commit/3e6ba0d44e6e189480719c78251d12a3e09e5cbd), [`1c2355e`](https://github.com/soundor/soundor/commit/1c2355efc2bd49c78cfe09a66fd71199f8f2e5fc), [`94a9f00`](https://github.com/soundor/soundor/commit/94a9f0099afb95fd60a4a012b084e4e960b72be8), [`453d4fe`](https://github.com/soundor/soundor/commit/453d4fe5661821ff20aebed3d6267980dba71b34), [`20ef0ae`](https://github.com/soundor/soundor/commit/20ef0ae64464b11fbf444d9dd1fc6f0b1441b13c)]:
  - @soundor/engine@0.11.0
  - soundor@0.20.0
  - @soundor/runtime-sdk@0.20.0

## 0.15.0

### Minor Changes

- [#349](https://github.com/soundor/soundor/pull/349) [`13a089b`](https://github.com/soundor/soundor/commit/13a089bc715071d97990f1e2c478e3d4793513bb) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Publish `native.events` from the Rust controller through typed `ctx.events` publishers in VST3 and the browser. UI subscriptions still use `events.name.subscribe(callback)`.

  Regenerate and rebuild plugins with matching versions of the CLI and runtime for the updated controller contract.

### Patch Changes

- Updated dependencies [[`e74a5cb`](https://github.com/soundor/soundor/commit/e74a5cb65971af3c00184d2c98e60911c7f347a6), [`01cc052`](https://github.com/soundor/soundor/commit/01cc0522b20fe89ad4a2ca398a23334c747c742a), [`4c20c74`](https://github.com/soundor/soundor/commit/4c20c74c6726bb34013368ee45d3421d25da1c1b), [`4a8f6a1`](https://github.com/soundor/soundor/commit/4a8f6a1ecaf26e9a3c3dc54c2727dbf495eae0b2), [`13a089b`](https://github.com/soundor/soundor/commit/13a089bc715071d97990f1e2c478e3d4793513bb), [`eddafd8`](https://github.com/soundor/soundor/commit/eddafd8cc98ce028ca971bf3b467f1c721194b00), [`2f0dd59`](https://github.com/soundor/soundor/commit/2f0dd59c87a607cb2190427ac2b50141511eba4d), [`7e64784`](https://github.com/soundor/soundor/commit/7e647849b2b552b9d111243396e4b0796149f7d0), [`ded85dd`](https://github.com/soundor/soundor/commit/ded85ddb840c59b24df299a646d08a89eaff3313)]:
  - @soundor/engine@0.10.0
  - soundor@0.19.0
  - @soundor/runtime-sdk@0.19.0

## 0.14.0

### Minor Changes

- [#303](https://github.com/soundor/soundor/pull/303) [`78f82f2`](https://github.com/soundor/soundor/commit/78f82f2a881ce4c5e88208823acf34e83ffa114e) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Declare plugin kind, categories and vendor metadata, audio buses and complete supported layouts, latency/tail reporting, parameter groups and a host bypass role. Generate JUCE host integration and explicit browser channel counts, with validation for unsupported browser buses. Existing projects retain handwritten audio setup unless they opt into the audio contract. MIDI and presets are separate features.

- [#320](https://github.com/soundor/soundor/pull/320) [`1cb3161`](https://github.com/soundor/soundor/commit/1cb3161731e2b34aa7aa4acb648514cc36d9309c) Thanks [@dm-balakin](https://github.com/dm-balakin)! - The engine hosts the plugin's Rust processor, natively and in the browser; the runtimes keep the audio callback, the AudioContext and the plugin's lifecycle. Neither the Rust SDK nor its ABI changes, and a plugin's code needs no change.

  - `@soundor/engine`: `soundor/processor/RustProcessor.h`, the bridge to the processor's C ABI (`RustProcessorAbi.h`, moved from the JUCE runtime), free of JUCE: `processor::RustProcessor` processes an array of channel pointers in place, and reaches the plugin's linked library through `processor::linkedRustProcessor()`, so the engine itself references none of its symbols. `@soundor/engine/web/processor`: `WasmProcessor`, the AudioWorklet and `createProcessorNode()`, moved from the web runtime, apart from `@soundor/engine/web`.
  - `@soundor/juce-runtime`: the generated processor uses the engine's bridge; `backend::RustProcessor` becomes `processor::RustProcessor` (`rustProcessor()` returns it), and the JUCE adapter (`JuceRustProcessor.h`) keeps `backend::rustBusLayout()`, `backend::rustTransport()` and `backend::processRust()`.
  - `@soundor/web-runtime`: the host loads the engine's processor host only once the plugin has a processor and audio starts. `@soundor/web-runtime/processor` is the engine's entry; `@soundor/web-runtime/client` no longer exports `createProcessorNode`, which `@soundor/web-runtime/processor` has.

- [#303](https://github.com/soundor/soundor/pull/303) [`a718364`](https://github.com/soundor/soundor/commit/a718364b0d93b117d542629fec11458c6995021f) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Declare validated factory presets in config and load them synchronously through soundor:presets or the generated C++ processor. Share the existing parameter/state stores and StateHistory, including opt-in atomic undo entries, nested transactions, selection and modified tracking, and restoration matching. Expose JUCE host programs from the same catalog; preserve DAW state/preset compatibility without changing the snapshot format. Include matching Web and simulated runtime APIs.

- [#327](https://github.com/soundor/soundor/pull/327) [`a114b13`](https://github.com/soundor/soundor/commit/a114b13ae6fe4924d9c7fb3b662c02285a8c97f7) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Manage the complete Web host inside the runtime package, without a scaffolded
  runtimes/web project. Configure built-in input sources with webRuntime({ inputs })
  or supply a browser TypeScript/JavaScript module and compose custom inputs with
  factories from @soundor/web-runtime/input. Custom input modules use a separate browser TypeScript project;
  projects using built-in inputs need no browser configuration. Legacy web host directories require explicit migration;
  the user-owned Vite integration entry is removed.

- [#326](https://github.com/soundor/soundor/pull/326) [`8002969`](https://github.com/soundor/soundor/commit/800296968109a085fd4711912ba196c7c650aede) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Require every plugin to export its Rust processor and controller. Scaffold separate entry, controller and processor modules, including an empty controller when no native methods are configured.

  Run the same generated Rust NativeMethods contract in browsers through WASM, with instance stores, wake-driven async execution, control-thread scheduling, host services and resource publication to the separate AudioWorklet processor. Remove production WebNativeApi implementations and the browser host's native option. Move those methods to Rust and regenerate/rebuild existing projects. The portable Send/Sync bounds remain; unblock is native-only, and browser futures execute cooperatively on the main thread.

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

- [#328](https://github.com/soundor/soundor/pull/328) [`3f303a0`](https://github.com/soundor/soundor/commit/3f303a014274a3b23d2a406db3e3aae44128c253) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Remove the `soundor init` command and runtime initialization hook. Runtime authors
  now implement only `gen`, `dev`, `build`, and `doctor`. Both first-party hosts
  remain package-managed, including the legacy-host migration diagnostics.

  `soundor gen` creates a Rust starter crate when `lib/Cargo.toml` is absent, preserving
  existing files and leaving existing crates untouched; development and builds run it automatically. Check mode remains read-only.
  New projects run generation after dependency installation.

- [#306](https://github.com/soundor/soundor/pull/306) [`84678d1`](https://github.com/soundor/soundor/commit/84678d157ca75d9cfa125d784c0ad07df3c7a5a6) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Rename `soundor:state-history` to `soundor:history`, its `stateHistory` export to `history`, and its `StateHistory` interface to `History`. Rename the React hook to `useHistory` and the generated JUCE processor member to `history`. Update imports, hook calls, and native member access to the new names.

- [#307](https://github.com/soundor/soundor/pull/307) [`3734cf5`](https://github.com/soundor/soundor/commit/3734cf524b2234af6de3368bfe4b1833aa73aa21) Thanks [@dm-balakin](https://github.com/dm-balakin)! - **Breaking:** the Web runtime runs the plugin's Rust processor, `lib/`, the one the JUCE plugin runs: `soundor dev web` and `soundor build web` compile it with Cargo for `wasm32-unknown-unknown`, the bundle carries the module, and the host runs it in an AudioWorklet (no wasm-bindgen, no `SharedArrayBuffer`, render quanta of any length), with the parameters and the transport posted to it and what it publishes (read-only parameters, native streams) brought back to the UI. `startSoundorWebHost()` no longer takes `audio`, and `WebAudioSetup` is gone: delete `runtimes/web/src/audio.ts` and move its processing into `lib/`. `init` no longer scaffolds `audio.ts`, and `soundor doctor` checks for the `wasm32-unknown-unknown` target. The Rust SDK's `soundor::export!` also defines the WebAssembly exports the worklet calls (`soundor_wasm_*`), on that target only. `createProcessorNode()` runs a processor module in any `BaseAudioContext`.

- [#331](https://github.com/soundor/soundor/pull/331) [`f28464c`](https://github.com/soundor/soundor/commit/f28464c9ef2dd445f1d6344197c93065dcc8a9cd) Thanks [@dm-balakin](https://github.com/dm-balakin)! - **Breaking:** the plugin's Rust processor and controller library now lives in `lib/`. Rename `native/` to `lib/`, update Cargo manifest paths in scripts and tooling, and run `soundor gen`. Legacy and ambiguous layouts produce a migration error without changing user files.

  Runtime authors must use `ctx.lib`, `LibraryBuildContext`, `LibraryBuildRequest`, and `LibraryArtifact` in place of the Rust crate's native-named context and types. Cargo options, processor/controller ABI, and the public `soundor:native` methods/events API are unchanged. Both JUCE and Web compile the same library for their targets.

- [#319](https://github.com/soundor/soundor/pull/319) [`ada8d88`](https://github.com/soundor/soundor/commit/ada8d88d2acb5643e8f10e8543b24756d721725a) Thanks [@dm-balakin](https://github.com/dm-balakin)! - The engine's WebAssembly comes from the installed `@soundor/engine`'s prebuilt release (`engine({ target: 'web' })`), downloaded once into the Soundor cache and verified when `soundor dev` or `soundor build` first needs it: a web plugin needs no Emscripten, CMake or C++ compiler. The page still loads it from the application's own assets. `SOUNDOR_ENGINE_WASM` still names a module to use instead, now checked to be the engine's and to speak the installed version's protocol.

- [#318](https://github.com/soundor/soundor/pull/318) [`1cd9728`](https://github.com/soundor/soundor/commit/1cd972818a1ff121eadbcdf0696ac47559ca99b5) Thanks [@dm-balakin](https://github.com/dm-balakin)! - The web runtime's `soundor:ui` is now the engine itself (`@soundor/engine/web`): its C++ core, compiled to WebAssembly, holds the node tree, reads styles and lays out with Yoga and its text engine, and its DOM adapter draws with HTML elements and CSS. The runtime's own TypeScript copy of the engine (its Yoga mapping, style checks, text layout and node tree) and its dependency on `@soundor/yoga-wasm` are gone: a page loads one engine module, served by `soundor dev` and emitted as an asset by `soundor build`. Plugins need no change; style errors now read exactly as natively. The module is built from the engine's sources (`pnpm --filter @soundor/engine build:wasm`) and is not yet published: outside the Soundor repository, `SOUNDOR_ENGINE_WASM` names one.

### Patch Changes

- [#301](https://github.com/soundor/soundor/pull/301) [`523dacc`](https://github.com/soundor/soundor/commit/523dacc94f532d589600232df16e6b4fc7e0ef65) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Clean up lint warnings and update callback references after React commits, keeping installed listeners stable.

- [#307](https://github.com/soundor/soundor/pull/307) [`6c7e0d9`](https://github.com/soundor/soundor/commit/6c7e0d95081345fe00b21238c44325436755d45f) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add allocation instrumentation to the Rust processor testing harness and the scaffold's tests. Count allocator calls only while processing, with a required counting allocator so missing instrumentation cannot pass silently. Exercise the Rust SDK, native FFI, JUCE adapter and example processors; compare Orbit's real VST3 output with its WebAssembly build. Document the shared Rust processor lifecycle, generated config contract, Cargo dependencies, runtime boundaries, testing and migration.

  Reuse prepared WebAssembly parameter, transport and channel views during processing, including partial and oversized blocks. Preallocate the worklet's channel arrays and silence missing inputs without allocating fallback buffers. Unexpected WASM memory growth fails silently instead of rebuilding views in the callback. Browser publication messages still allocate; these checks do not claim a hard real-time guarantee.

- [#344](https://github.com/soundor/soundor/pull/344) [`49d772d`](https://github.com/soundor/soundor/commit/49d772db72626e65523d33e39df3b1b4982d0e01) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Size the web host to the dynamic viewport so mobile browser toolbars do not create an extra page scroll area.
- Updated dependencies [[`523dacc`](https://github.com/soundor/soundor/commit/523dacc94f532d589600232df16e6b4fc7e0ef65), [`78f82f2`](https://github.com/soundor/soundor/commit/78f82f2a881ce4c5e88208823acf34e83ffa114e), [`1cb3161`](https://github.com/soundor/soundor/commit/1cb3161731e2b34aa7aa4acb648514cc36d9309c), [`3604ae0`](https://github.com/soundor/soundor/commit/3604ae0607b21ec145ea23ca1f0e0f0630383ef7), [`ada8d88`](https://github.com/soundor/soundor/commit/ada8d88d2acb5643e8f10e8543b24756d721725a), [`1cd9728`](https://github.com/soundor/soundor/commit/1cd972818a1ff121eadbcdf0696ac47559ca99b5), [`a718364`](https://github.com/soundor/soundor/commit/a718364b0d93b117d542629fec11458c6995021f), [`64dae3a`](https://github.com/soundor/soundor/commit/64dae3a08ca8d53373c00b0da044e1d3deae9657), [`b4dcb85`](https://github.com/soundor/soundor/commit/b4dcb858fd0b2df59f889e084c153da91f3cd532), [`055652b`](https://github.com/soundor/soundor/commit/055652b2346857a8fea29210b0b18e98a57e665e), [`8002969`](https://github.com/soundor/soundor/commit/800296968109a085fd4711912ba196c7c650aede), [`085d5a6`](https://github.com/soundor/soundor/commit/085d5a607fde5a76fb87986d90f49b350bc75c41), [`23162f7`](https://github.com/soundor/soundor/commit/23162f7bf06b592d48f129c3255bb5d2de47a856), [`46649cc`](https://github.com/soundor/soundor/commit/46649cc40ca384bf0cf2bb1fc5da64ef38a6a771), [`c15667d`](https://github.com/soundor/soundor/commit/c15667dee72d1d70cb3bf8c19275791fd5fc93a6), [`78110fd`](https://github.com/soundor/soundor/commit/78110fd88e634834c200aab4124832de2336f0e3), [`51ebf5e`](https://github.com/soundor/soundor/commit/51ebf5e749cc16c286a90de5e7aa217fc6d5a65d), [`bb8b0a0`](https://github.com/soundor/soundor/commit/bb8b0a051a150d6edb2ef1859fae66bc3169f09d), [`e7235c9`](https://github.com/soundor/soundor/commit/e7235c9a4e7bd815867e361920771da6b743c67d), [`ec80d0c`](https://github.com/soundor/soundor/commit/ec80d0cdb7860534f06f6dc60175e70de836ac72), [`b7dbe5f`](https://github.com/soundor/soundor/commit/b7dbe5fa46dca1be9c82094ae2482a37610aa194), [`439c5f4`](https://github.com/soundor/soundor/commit/439c5f4355ba1656ac1c3b472ba93ff3fc701fb6), [`3f303a0`](https://github.com/soundor/soundor/commit/3f303a014274a3b23d2a406db3e3aae44128c253), [`4538468`](https://github.com/soundor/soundor/commit/45384688f74ac2f84083d1e3884e7eab6d436e27), [`84678d1`](https://github.com/soundor/soundor/commit/84678d157ca75d9cfa125d784c0ad07df3c7a5a6), [`d3fe0e2`](https://github.com/soundor/soundor/commit/d3fe0e284f82c13386d90c64803fb1e6475ab91e), [`3734cf5`](https://github.com/soundor/soundor/commit/3734cf524b2234af6de3368bfe4b1833aa73aa21), [`ec9f9e7`](https://github.com/soundor/soundor/commit/ec9f9e734c75fe1b6622df88a8862a45aa8008bf), [`f28464c`](https://github.com/soundor/soundor/commit/f28464c9ef2dd445f1d6344197c93065dcc8a9cd), [`6c7e0d9`](https://github.com/soundor/soundor/commit/6c7e0d95081345fe00b21238c44325436755d45f), [`5135f82`](https://github.com/soundor/soundor/commit/5135f8253f2af5c02ea257651670966ccb7b2af4), [`49d772d`](https://github.com/soundor/soundor/commit/49d772db72626e65523d33e39df3b1b4982d0e01), [`49d772d`](https://github.com/soundor/soundor/commit/49d772db72626e65523d33e39df3b1b4982d0e01)]:
  - @soundor/engine@0.9.0
  - soundor@0.18.0
  - @soundor/runtime-sdk@0.18.0

## 0.13.1

### Patch Changes

- [#295](https://github.com/soundor/soundor/pull/295) [`fb09052`](https://github.com/soundor/soundor/commit/fb09052f7ede4932f243c5d191860267bc524a36) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Expose `soundor:state-history` to playground scripts so examples using `useStateHistory` can render and undo or redo edits.

- [#298](https://github.com/soundor/soundor/pull/298) [`582aeec`](https://github.com/soundor/soundor/commit/582aeec3a8191fc664d4a426dd295557918be8ee) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Publish all packages through npm trusted publishing with GitHub Actions OIDC.

- [#297](https://github.com/soundor/soundor/pull/297) [`f4f214e`](https://github.com/soundor/soundor/commit/f4f214ec4ee4fd59754d1f9342ecf6435ada54f3) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Place built-in scrollbars inside the border over the view's padding, while preserving the content-box scroll range and thumb proportions.
- Updated dependencies [[`582aeec`](https://github.com/soundor/soundor/commit/582aeec3a8191fc664d4a426dd295557918be8ee)]:
  - @soundor/yoga-wasm@0.1.1
  - @soundor/runtime-sdk@0.17.1

## 0.13.0

### Minor Changes

- [#254](https://github.com/soundor/soundor/pull/254) [`0ada0c5`](https://github.com/soundor/soundor/commit/0ada0c58f97b5a60ae76299895e98b0592051624) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Box shadows in the web runtime: `style.boxShadow` becomes CSS's `box-shadow`, checked with the JUCE runtime's errors.

- [#252](https://github.com/soundor/soundor/pull/252) [`3275981`](https://github.com/soundor/soundor/commit/32759813fd8c6ef0f59fa10f7d2c2dc6e2f291a3) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Double clicks in the web runtime: a click's `detail` is the browser's own count (by the platform's double-click time), and the second click of a series is followed by a `dblclick`, as in the JUCE runtime. A real release's click waits for the browser's `click` right after it, and is a single click when none comes; the browser's own `dblclick` no longer leaves the view.

- [#289](https://github.com/soundor/soundor/pull/289) [`a54e1da`](https://github.com/soundor/soundor/commit/a54e1da16a93c0097789c8e9e974632f4b12526c) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Expose plugin version and runtime environment in soundor:host, and extend host state with processing mode, sample precision, optional track metadata, loop boundaries and timecode. Rename snapshot/subscribe to getHostState/subscribeHostState. Configure plugin.version (default 0.1.0) consistently across formats.

- [#266](https://github.com/soundor/soundor/pull/266) [`496fe62`](https://github.com/soundor/soundor/commit/496fe623abcf179945db4b2df92f873cf399bb87) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Accept synchronous functional updaters on parameter and persistent state fields. Resolve once against the latest immutable store value, validate before publishing, and reject asynchronous results. Automatically bracket changed automatable parameter writes in a host gesture when no explicit gesture is active, preserving nested gestures and keeping state gestures explicit.

  Raise the runtime API version to 4 for the compatible setter addition; older runtime API versions remain supported.

- [#281](https://github.com/soundor/soundor/pull/281) [`0354f73`](https://github.com/soundor/soundor/commit/0354f730087bbde8a2f7ad34ca7595c373c20c20) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Native channels on the Web: the generated contract exports `channels`, a `publish()` per declared channel for the project's `runtimes/web` code (`channels.spectrum.publish(values)`, an AnalyserNode read every frame). Each value is checked, a buffer copied, and one longer than its `maxLength` refused; the plugin UI receives the newest at the next animation frame, so a hidden page keeps one value per channel. The manifest lists the channels.

- [#280](https://github.com/soundor/soundor/pull/280) [`27a3303`](https://github.com/soundor/soundor/commit/27a330313c40db624ef897111a5ab37a320f3ea0) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Native events on the Web: the generated contract exports `events`, one publisher per declared event, for `runtimes/web/src/native.ts` (`events.presetLoaded({ path })`). Each checks its value as the JUCE bindings do, and the plugin UI's subscribers receive it right after the publishing code returns, in order; the page holds at most 1024 undelivered events. The manifest lists the events.

- [#255](https://github.com/soundor/soundor/pull/255) [`13da21d`](https://github.com/soundor/soundor/commit/13da21de509056defdaf7959cc7af78eb345ea1a) Thanks [@dm-balakin](https://github.com/dm-balakin)! - **Breaking:** `soundor:native` in the browser checks and converts every call as the JUCE runtime does, with its errors word for word: sized numbers are never coerced (`float32` rounded with `Math.fround`, 64-bit integers bigints), `null` only for `T?`, buffers exactly their typed array, and structs and arrays copied with their declared fields only. What the implementation returns is checked too, and copied. Argument errors of async methods are thrown, not rejected, as natively. `defineHandle()`, `WebNativeHandle` and `WebNativeHandleType` are removed with handles. The manifest carries the native API's types.

- [#258](https://github.com/soundor/soundor/pull/258) [`553d8c4`](https://github.com/soundor/soundor/commit/553d8c430aab0c1e620dbd9d9be62448d41982f6) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Parameters run the behavior `gen` compiles to JavaScript (`parameters.js`) from the same expressions as the JUCE runtime's C++: mapping, steps, `format` and `parse`. The host's controls move through normalized positions and show formatted values and choice labels; read-only parameters are disabled there, and `setupAudio` receives `publish(parameter, value)` to set them.

- [#263](https://github.com/soundor/soundor/pull/263) [`14b7be0`](https://github.com/soundor/soundor/commit/14b7be04bb0262c6359ba08aac2087315f72d71f) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add typed persistent application state through `soundor:state`, reusing native type declarations and validated defaults, with field subscriptions and React `useStateValue()`.

  JUCE owns state per processor, saves parameters and state together, accepts legacy APVTS projects, and calls the protected `stateRestored()` hook on the message thread after each complete restoration. Off-thread host restorations queue to that thread. Web hydrates before application startup and automatically saves snapshots to application-namespaced IndexedDB. Runtime API 2 gates state configuration for older runtimes.

- [#289](https://github.com/soundor/soundor/pull/289) [`67ffaac`](https://github.com/soundor/soundor/commit/67ffaacba3038901877563c40af773dfc2122e7d) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add soundor:env with explicit, typed, readonly public configuration values and DEV/PROD/MODE built-ins. Embed values in the shared UI bundle, resolve the same module for web host code, and support isolated configuration in the test runtime. No process environment is exposed implicitly.

- [#288](https://github.com/soundor/soundor/pull/288) [`02d06a8`](https://github.com/soundor/soundor/commit/02d06a814f8fb77b2fd8fa78f73d0c8edc809ebd) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add boolean `soundor:ui` isVisible()/subscribeVisibility() and isFocused()/subscribeFocus() APIs so plugins can react to editor visibility and keyboard focus across runtimes. Add test runtime setters and Testing Library editor helpers. The analyzer example pauses its UI subscriptions while hidden.

- [#275](https://github.com/soundor/soundor/pull/275) [`258c891`](https://github.com/soundor/soundor/commit/258c8911cecc26d26e22c7bcc0d78d52dde66fc7) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Runtime packages now declare supported Soundor CLI versions through a required `soundor` peer dependency. Both first-party runtimes use a caret range matching their regular `@soundor/runtime-sdk` dependency; the SDK and CLI share the fixed package version. Before 1.0, this supports the current minor and its patches. Runtime providers own the supported range, and package managers handle peer mismatches without an additional CLI compatibility check.

  Remove the numeric `Runtime.apiVersion` and `ResolvedRuntime.apiVersion`, runtime API version constants and contract record, config-feature version gates, compatibility helpers, and `RuntimeCompatibilityError` with its dedicated error codes. Third-party runtimes should remove those imports and fields, keep the SDK as a regular dependency, and declare the supported CLI range in `peerDependencies.soundor`. The existing project config release-line check and cross-copy error protocol remain.

- [#264](https://github.com/soundor/soundor/pull/264) [`61798d1`](https://github.com/soundor/soundor/commit/61798d199d6c5a32d1f8118fba4f67184e280a13) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add optional beginGesture() and endGesture() methods to persistent state fields in JavaScript and native JUCE code. Gestures nest per field, leave writes immediate, reset on restoration, and clean up unfinished UI interactions without host automation or History recording.

  Raise the runtime API version to 3 for the additional state field methods; older runtimes remain accepted.

- [#267](https://github.com/soundor/soundor/pull/267) [`553076d`](https://github.com/soundor/soundor/commit/553076ddfee437804ce959495d967af8bd9081d2) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add processor-owned StateHistory with opt-in discrete edits, History-enabled parameter/state gestures, synchronous buffered transactions, undo/redo, subscriptions, and useStateHistory(). JavaScript and native C++ share one manager in JUCE; Web and simulated runtimes implement the same contract. History survives editor recreation and clears on project restoration. Runtime API 5 is now required so older runtimes cannot silently ignore History options.

### Patch Changes

- [#256](https://github.com/soundor/soundor/pull/256) [`d5b9b16`](https://github.com/soundor/soundor/commit/d5b9b167c52bea1113785d84d62fb78e8409d06d) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Depends on one Soundor package, `@soundor/runtime-sdk`, which its code imports (instead of inlining it): no `@soundor/config` peer, and no `@soundor/core`. Its browser client imports the springs from `@soundor/runtime-sdk/client` and inlines them. It implements runtime API 1, which the CLI checks before running it.
- Updated dependencies [[`3275981`](https://github.com/soundor/soundor/commit/32759813fd8c6ef0f59fa10f7d2c2dc6e2f291a3), [`d5b9b16`](https://github.com/soundor/soundor/commit/d5b9b167c52bea1113785d84d62fb78e8409d06d), [`553d8c4`](https://github.com/soundor/soundor/commit/553d8c430aab0c1e620dbd9d9be62448d41982f6), [`14b7be0`](https://github.com/soundor/soundor/commit/14b7be04bb0262c6359ba08aac2087315f72d71f), [`67ffaac`](https://github.com/soundor/soundor/commit/67ffaacba3038901877563c40af773dfc2122e7d), [`258c891`](https://github.com/soundor/soundor/commit/258c8911cecc26d26e22c7bcc0d78d52dde66fc7), [`3a778e2`](https://github.com/soundor/soundor/commit/3a778e22214860be850efe603802a955f3fdda52)]:
  - soundor@0.17.0
  - @soundor/runtime-sdk@0.17.0
  - @soundor/yoga-wasm@0.1.0

## 0.12.0

### Minor Changes

- [#238](https://github.com/soundor/soundor/pull/238) [`2daa8a0`](https://github.com/soundor/soundor/commit/2daa8a0a47aa8413d4e2d50fed3660e095080762) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `ResizeObserver` is a global that observes nodes, as on the Web: its callback is told after a frame's `requestAnimationFrame` callbacks and layout of each node whose content, border or device-pixel content box changed size. In the web runtime it takes the browser's place for nodes, and passes DOM elements on to it. The simulated runtime's observes nodes and never calls back, as nothing is laid out there. `useScrollbar` no longer reads sizes every frame: it is told of changes by a `ResizeObserver` and by `scroll` events. New `useCanvasSize` keeps a canvas's drawing buffer exactly the device pixels its box covers.

- [#240](https://github.com/soundor/soundor/pull/240) [`ca0158b`](https://github.com/soundor/soundor/commit/ca0158b66bafff553e878c642f3b33aff25942c9) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Any view scrolls when its style says so, an `Animated.View` too: `overflow: 'scroll'` scrolls, as in CSS, and `overflowX` and `overflowY` scroll one axis (they win over `overflow`). `ScrollView` is now a view with that style, its children in a content container, and it always scrolls; `scrollIndicators` and `onScroll` are props of every `View`. Nodes scroll smoothly with `scrollTo()`/`scrollBy()` and `behavior: 'smooth'`, and `scrollIntoView()` brings a node into view in every view around it that scrolls.

  Breaking:

  - `createScrollView()` and the `'scroll'` node type are gone: create a view with `overflow: 'scroll'`.
  - `overflow: 'scroll'` on a view scrolls it; it used to only clip, as `'hidden'` still does.
  - `scrollTo()` on a node that does not scroll does nothing, as in browsers, instead of throwing.
  - `useScrollbar(ref)` returns `{ vertical, horizontal }`, a bar for each axis, and no longer takes `axis`: `useScrollbar(ref, { axis: 'horizontal' })` is `useScrollbar(ref).horizontal`.

- [#235](https://github.com/soundor/soundor/pull/235) [`9110364`](https://github.com/soundor/soundor/commit/9110364ad76f83d4e4b9f428c7a52e72f8267837) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `useScrollbar` makes a scrollbar of your own from ordinary nodes, and `ScrollView`'s `scrollIndicators={false}` leaves out the built-in one. Nodes gain `scrollIndicators`, `clientWidth` and `clientHeight`.

- [#234](https://github.com/soundor/soundor/pull/234) [`5964ac0`](https://github.com/soundor/soundor/commit/5964ac08ea858df571878b723b37fad177f375b3) Thanks [@dm-balakin](https://github.com/dm-balakin)! - The web runtime now lays out with Yoga, the engine's own, compiled to WebAssembly: a plugin UI gets the same boxes in the browser as in a plugin. CSS only draws them. Text wraps as natively, only at spaces and line breaks, text and inputs sit on the same baselines, and scroll views draw the JUCE runtime's thin indicators in place of the browser's scrollbar. Under a strict Content Security Policy the page needs `wasm-unsafe-eval`.

### Patch Changes

- [#239](https://github.com/soundor/soundor/pull/239) [`8a8f912`](https://github.com/soundor/soundor/commit/8a8f912207d8b1d61832ad7042c63fc395fdb729) Thanks [@dm-balakin](https://github.com/dm-balakin)! - The wheel with Control, which is how a browser reports a trackpad's pinch, no longer scrolls a scroll view: the browser zooms the page as it does elsewhere, unless plugin code calls `preventDefault()` to zoom something of its own. Before, a pinch over the plugin scrolled its content and the page could not be zoomed from there. And a wheel no scroll view can use any more, at the end of its content, now goes on to the page, as natively to the host: a page zoomed past the window can be scrolled with the pointer over the plugin.

- [#238](https://github.com/soundor/soundor/pull/238) [`2daa8a0`](https://github.com/soundor/soundor/commit/2daa8a0a47aa8413d4e2d50fed3660e095080762) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Scrolling a scroll view from code (`scrollTo`, `scrollBy`, `scrollTop`, `scrollLeft`) now fires its `scroll` event in the web runtime too, once, on the browser's next frame, as in the JUCE runtime; dragging or pressing its scrollbar fires it at once, as the wheel does.

- [#235](https://github.com/soundor/soundor/pull/235) [`9110364`](https://github.com/soundor/soundor/commit/9110364ad76f83d4e4b9f428c7a52e72f8267837) Thanks [@dm-balakin](https://github.com/dm-balakin)! - A mouse can use a scroll view's indicators: near the scroll view's edge a track appears under a grown bar, which can be dragged, and a press on the track jumps there. After touch, indicators show only while scrolling.
- Updated dependencies [[`7fb3f13`](https://github.com/soundor/soundor/commit/7fb3f13f2e3435764e0c5c84ba0b2c44ef805430), [`8985215`](https://github.com/soundor/soundor/commit/8985215b4ebe4c88267c407249c404c93fb0ff83), [`f8d5230`](https://github.com/soundor/soundor/commit/f8d5230800a595375880743dea71c053d02311a6)]:
  - @soundor/core@0.16.0
  - @soundor/yoga-wasm@0.1.0

## 0.11.0

### Minor Changes

- [#201](https://github.com/soundor/soundor/pull/201) [`54ed098`](https://github.com/soundor/soundor/commit/54ed098e0c0aeb21665057b03ff26fb95195c2cc) Thanks [@dm-balakin](https://github.com/dm-balakin)! - A resizable editor's limits are now what it asks for. By default it opens at its size and only grows, without a maximum: `minWidth`/`minHeight` default to the opening size, and `maxWidth`/`maxHeight` to `Infinity` (which a config may also write). The limits, and the aspect ratio of an editor that scales (`editor.keepAspectRatio`, default `true`), are offered to hosts that ask and kept by the Standalone and the web host's handle; a host that sets a larger window or another shape regardless (Ardour) gets it, the minimum only held. `editor.fit` decides what the UI does in such a window, for every resizable editor: `'contain'`, the default, lays it out at most at its maximum (or, scaling, at its zoom, capped by the maximum) in the middle, with bands of the editor's background; `'cover'` lays it out over the whole window, `viewSize().safeArea` (and `useViewSize()`) saying where the part it was made for is. The web host applies the same rules in `?embed`, where the page owns the size, and hides its handle where the limits allow no other size. `soundor:ui` adds `editorSize()` and `subscribeEditorSize()`, the editor's actual size in its own logical pixels, told once per change whoever resized it. `EditorConfig` is now a union that allows `fit` only with `resizable: true` and `keepAspectRatio` only with `resize: 'scale'` (validation rejects `fit: 'cover'` and `keepAspectRatio: true` elsewhere), and reports a maximum below the opening size; `ResolvedEditorConfig` always has both, and `DEFAULT_EDITOR_LIMITS` is gone. In tests, `testView.resize({ safeArea })` sets the safe area and `testEditor.resize()` the editor's size.

- [#201](https://github.com/soundor/soundor/pull/201) [`bffc8ea`](https://github.com/soundor/soundor/commit/bffc8ea6d3a1d00bc3977d3a7f1765ff926447a0) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `soundor:ui` gains `requestEditorSize(width, height)`: plugin code asks for another editor size, any finite one, held to the editor's limits (and, scaling, its aspect ratio), which the host gives or not; it returns the size asked of the host, or `null` where none can be; `editorSize().resizable` says whether it can ask (false for a fixed editor and in `?embed`). Pointer events gain `screenX`/`screenY`, the pointer on the screen in the editor's pixels, so a resize grip drawn by the UI measures its drag in units the resize does not change. The JUCE editor applies requests with `setSize()` after the UI's code ran, telling the host, and keeps later requests to a minimum or maximum the host showed by giving another size in place of one asked for (Ardour's window), so a grip does not spring back at every step; the Web host resizes its viewport as its handle does. The test runtime simulates requests (`testEditor.requests()`, `editor: { resizable, minWidth, …, aspectRatio, applyRequests }`). An editor that scales keeping its aspect ratio is given the size at its ratio nearest to the one asked for, by a request or by the Web host's handle, whatever its size is, so a corner dragged narrower and taller no longer grows and shrinks in turn. The Basic and Orbit examples draw a grip of their own.

- [#193](https://github.com/soundor/soundor/pull/193) [`36e2599`](https://github.com/soundor/soundor/commit/36e2599acb42049a8b129055faf150af2e72874e) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `editor.resize: 'scale'` makes a resizable editor zoom rather than lay its UI out again: the UI stays laid out at `width`×`height`, and resizing draws it larger or smaller, keeping its aspect ratio (default limits: half and twice the size). In JUCE the editor offers its aspect ratio to the host (and keeps it in the Standalone), takes whatever shape a host that ignores it gives (Ardour) with the UI letterboxed in the middle, and draws the surface at the zoom, converting pointer, wheel, pointer lock and accessibility coordinates; in the web host the handle sets the zoom, and `embed` fills the iframe at the editor's layout. `useViewSize()` keeps `width` and `height` and reports the zoom in `scale`. The default, `resize: 'layout'`, is unchanged.

- [#206](https://github.com/soundor/soundor/pull/206) [`2a5caa9`](https://github.com/soundor/soundor/commit/2a5caa9156a2335de3490835886d19734fd64e66) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Focus rings that show only for the keyboard, and outlines to draw them with. `node.focusVisible` (`soundor:ui`) is CSS's `:focus-visible`: focus a pointer press gave is not shown until a key is pressed (not a shortcut nor a modifier on its own), focus moved by Tab, assistive technology or code after a key is, and a text input's always is. Every runtime decides it by the same rules, the web runtime too rather than by the browser's. A `focusvisiblechange` event (React: `onFocusVisibleChange`) fires whenever it changes, `FocusEvent.focusVisible` says what it is, and `pressable()`'s state and React's `PressableState` have `focusVisible`. The new styles `outlineWidth`, `outlineColor` and `outlineOffset` draw a line around a node as CSS's `outline`: outside its border, following its corners, taking no room in layout and not hit, so a ring can appear without moving anything.

- [#194](https://github.com/soundor/soundor/pull/194) [`003c103`](https://github.com/soundor/soundor/commit/003c103191eb4bec37df0aca7bad4d8e3fbdbe4f) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Support bundled SVG assets through Image with the existing content-addressed asset IDs and TypeScript imports. Native images cache bounded Skia SVG documents and render them at the effective physical resolution; Web images use the browser's image decoder. Preserve Image sizing and resize modes, with documented SVG intrinsic-size fallbacks and compatibility limits.

- [#194](https://github.com/soundor/soundor/pull/194) [`6a677ac`](https://github.com/soundor/soundor/commit/6a677ac5d2d56b31f2101435ff6d3b69f31108db) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add soundor:ui createSvg and the bounded, atomic SVG scene protocol v1. SVG roots are Yoga leaves with normal input and accessibility. Native scenes retain Skia geometry with shared path caching and damage tracking; Web scenes use native SVG elements. Add scene update, path parse and draw counters to native benchmark reports. This protocol requires engine 0.6.0 or later; React components follow through the existing React package.

- [#186](https://github.com/soundor/soundor/pull/186) [`96ef938`](https://github.com/soundor/soundor/commit/96ef938d7c0fc4dc745168a7083566400250a4a8) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `useViewSize()` in `@soundor/react` returns the plugin view's `{ width, height }` in logical pixels and its `scale` (device pixels per logical pixel), and re-renders when they change: the user resized the editor, a web host's embedding iframe changed size, or the view moved to a display of another density. It never re-renders for an unchanged size and does not poll. Underneath, `soundor:ui` has `subscribeViewSize(listener)`, and `viewSize()` is now the same frozen object until the size changes, so the pair works with `useSyncExternalStore`. The JUCE runtime tells subscribers once per change, on the editor's tick before the frame at the new size; the web runtime measures the view with the `ResizeObserver` that already updates hover, follows the page's pixel density and the host's scaling. In tests the view starts at the project's editor size, and `testView.resize()` changes it; the simulated `viewSize()` no longer throws.

- [#186](https://github.com/soundor/soundor/pull/186) [`9eac514`](https://github.com/soundor/soundor/commit/9eac5140d08de388a7833eacded39819e6735a72) Thanks [@dm-balakin](https://github.com/dm-balakin)! - The web host opens the plugin view at the config's `editor` size (800×600 by default, as before), which the manifest now carries, rather than a size of its own. A resizable editor (`editor.resizable`) gets a handle just outside the view's corner in the `demo` and `dev` presentations: dragging it (or the arrow keys, with it focused) changes the view's logical size within the editor's limits and the page's room, so the UI is laid out again rather than scaled; a drag the browser cancels puts the size back. A fixed editor is scaled down to fit a smaller page as before, and `?embed` still fills its iframe, following it as the parent page resizes it.

### Patch Changes

- [#192](https://github.com/soundor/soundor/pull/192) [`c0420b2`](https://github.com/soundor/soundor/commit/c0420b2f70d747959292c7d1f7feac7db089268d) Thanks [@dm-balakin](https://github.com/dm-balakin)! - The JUCE and web runtimes lay out more styles the same. Natively, a box with no room (in a container squeezed to zero) keeps its content's size rather than its padding's (Yoga's shortcut for it is patched out), and a fixed `width` or `height` counts in a parent sized by its content after its `min*`/`max*` clamp. In the browser, `flex: n` (or a fixed `flexBasis`) adds only its basis to a row sized by its content, and `aspectRatio` wins over the stretch as in Yoga (with both sizes given, the one along the parent's direction stays). In the browser, a hidden node's (or its children's) `layout` is all zeros and its `getBoundingClientRect()` at its nearest shown ancestor, as natively, rather than at the page's corner. The cases that still differ are listed in the web runtime's guide, "Where layout differs".

- [#197](https://github.com/soundor/soundor/pull/197) [`128f5fe`](https://github.com/soundor/soundor/commit/128f5fe2cf4d999ecaa34de8c5584e2acca44900) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Show the Soundor icon in the DevTools dashboard (header and favicon) and in the Web host's settings panel.
- Updated dependencies []:
  - @soundor/core@0.15.0

## 0.10.0

### Minor Changes

- [#180](https://github.com/soundor/soundor/pull/180) [`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Projects no longer list `@soundor/core`. It is now a regular dependency of every package that imports it, instead of a peer dependency the project had to provide. The CLI, `@soundor/config`, `@soundor/runtime-sdk` and `@soundor/vitest` pin the exact version their release group shares, so a project still gets one copy. The runtimes take it with a caret range. New projects from `create-soundor-app` no longer include it, and an existing project can remove it from its `devDependencies`.

- [#184](https://github.com/soundor/soundor/pull/184) [`2a4f506`](https://github.com/soundor/soundor/commit/2a4f506dd54207a927aeccf4dc1267b0a2ebfe2c) Thanks [@dm-balakin](https://github.com/dm-balakin)! - A `cursor` style sets the pointer's shape over a node and its children: `'auto'` (the default, the parent's: the arrow at the root, the I-beam in a text input), `'default'`, `'none'`, `'pointer'`, `'text'`, `'crosshair'`, `'move'`, and the `'ew-'`, `'ns-'`, `'nesw-'` and `'nwse-resize'` cursors. While a pointer is pressed, the pressed node's cursor shows wherever it is dragged. Both runtimes resolve it the same way; the JUCE runtime shows the platform's own cursors.

  Hover follows what changes under a pointer that does not move, as in browsers: when the tree, a layout or a scroll puts another node under a still mouse, `pointerleave` and `pointerenter` fire (and Pressable's `onHoverIn`/`onHoverOut`), and the cursor follows, in the next tick or frame.

- [#185](https://github.com/soundor/soundor/pull/185) [`be7853c`](https://github.com/soundor/soundor/commit/be7853cc5ccbc2e402abb0dc42fe2a99a121e5dd) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Pointer events have `movementX`/`movementY`: how far the pointer moved since its previous event, in logical pixels. A node can lock the pointer while it is pressed, for knobs and faders that turn past the screen's edge: `node.requestPointerLock()` (from `pointerdown`) hides the pointer, the screen's edges no longer stop it, its events stay at the position the lock began with only the movement changing, and on release (or `exitPointerLock()`) the pointer shows again where it began. `pointerLockNode()` is the node holding it. The JUCE runtime keeps the hidden pointer in the view, moving it back as it strays, and ends the lock however the press ends; the web runtime uses the browser's Pointer Lock. The implicit pointer capture now starts before the `pointerdown` listeners run, so they can lock the press. The test runtime and `user.pointer` support both.

- [#178](https://github.com/soundor/soundor/pull/178) [`ce7601d`](https://github.com/soundor/soundor/commit/ce7601d1df6706d3d8957bb84247fee5568bd530) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Bring your own fonts: `import inter from './Inter.ttf'` (or `.otf`) bundles a font file, and `registerFont('Inter', inter, { weight, style })` from `soundor:ui` makes it a face of a family, as CSS's `@font-face` does. Text whose `fontFamily` is a registered family is set in its closest registered face (bold and italic synthesized where none is), in views and canvases alike; text already shown is laid out again. In the web runtime, a `fontFamily` is now quoted in CSS (unless generic), so names such as `'Inter 18pt'` work as they do natively.

- [#180](https://github.com/soundor/soundor/pull/180) [`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba) Thanks [@dm-balakin](https://github.com/dm-balakin)! - The runtime that runs another form of the UI now makes that form itself. The CLI bundles the UI into one ES module, `bundle.mjs`. The JUCE runtime lowers it for Hermes with the `toNativeModule()` of the engine it links (`@soundor/engine/native-module`), into `.soundor/cache/juce/ui-debug` or `ui-release`. The lowering therefore always matches the plugin's engine, and a web-only project no longer pays for it.

  `ctx.ui.entry` is removed. In `soundor dev`, `ctx.ui.live` gains `onBuild(listener)` and `sourceMap(file, mapFile)`, so that a runtime can remake its form after every build and have its stack frames mapped. `@soundor/core` no longer depends on `@soundor/engine` and no longer exports `toNativeModule()`; import it from `@soundor/engine/native-module`.

### Patch Changes

- [#184](https://github.com/soundor/soundor/pull/184) [`567a831`](https://github.com/soundor/soundor/commit/567a8319c01a598fa85b6ed00f3c6aa0006c1aa6) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Selecting text in a text input with the mouse (dragging, double-clicking) works in Firefox: a press in an input no longer captures the pointer for the view, which kept Firefox's own text selection from getting the moves. The press still goes to the input, and a release outside the view still ends it.
- Updated dependencies [[`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba), [`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba), [`4588cca`](https://github.com/soundor/soundor/commit/4588cca3b50a0db869c8d220408dbf23c477f1f2), [`ce7601d`](https://github.com/soundor/soundor/commit/ce7601d1df6706d3d8957bb84247fee5568bd530), [`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba), [`2e2080e`](https://github.com/soundor/soundor/commit/2e2080e0e9d45ba6fa77a0ff4449b6db51fe25e8)]:
  - @soundor/core@0.14.0

## 0.9.1

### Patch Changes

- [#172](https://github.com/soundor/soundor/pull/172) [`57cfc9f`](https://github.com/soundor/soundor/commit/57cfc9f06bc074ae820def8797a4f44963711f79) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Update dependencies: `@fastify/static` 10, React 19.3.1, Vite 8.3.5, Vitest 5.0.5 and rolldown 1.2.15.

## 0.9.0

### Minor Changes

- [#160](https://github.com/soundor/soundor/pull/160) [`4974b0d`](https://github.com/soundor/soundor/commit/4974b0dfbd49c801d61488341d6fa05d4c8b3239) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Soundor Driver: `@soundor/driver` connects to a running plugin's DevTools session as a control client and inspects its native UI (targets, the node tree, node details, and lazy locators by debug ID, role or text); `soundor driver targets|tree|inspect` does the same from the command line, with `--json` output and stable exit codes. Components take a `debugId` prop (`node.debugId` in `soundor:ui`), which DevTools shows and the Driver finds nodes by.

## 0.8.0

### Minor Changes

- [#152](https://github.com/soundor/soundor/pull/152) [`9b7e411`](https://github.com/soundor/soundor/commit/9b7e4118e1a69c1694f35c05dba37e657b1fa9ee) Thanks [@dm-balakin](https://github.com/dm-balakin)! - The web host starts audio on the page's first user gesture, wherever it is (a knob in the plugin, a key, Play), so its dock no longer has a Start audio button: the speaker button mutes and unmutes, and offers a retry only when audio failed to start.

- [#158](https://github.com/soundor/soundor/pull/158) [`3c82edc`](https://github.com/soundor/soundor/commit/3c82edc8430cbce7515bee3b55b0415dfb13f1a6) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add microphone input and named custom audio inputs to the web host's Audio settings. `startSoundorWebHost` accepts `audioInputs` with typed source factories and `defaultAudioInput` for a custom default. Inputs use the host's AudioContext and feed the plugin's normal DSP input. Capture and custom resources are released on pause, source changes, or disposal, including late asynchronous results. The panel reports permission/startup errors and supports retrying an input.

- [#153](https://github.com/soundor/soundor/pull/153) [`c70bdfb`](https://github.com/soundor/soundor/commit/c70bdfb2c3591d2081cc60e25d25065242b1d36f) Thanks [@dm-balakin](https://github.com/dm-balakin)! - A static build opened with `?embed` shows the plugin view alone, as big as the page or iframe: no dock or settings panel, and no scaling to the editor's size. The Soundor website uses it, with playground mode, to run its documentation's snippets.

- [#151](https://github.com/soundor/soundor/pull/151) [`f183169`](https://github.com/soundor/soundor/commit/f183169b1ced9ac6dd75ddc1d500192ddd4fb472) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Playground mode: opened with `?playground=<script>`, a static build loads that script (from the page's own origin only) instead of the plugin UI, gives it the host's `soundor:*` modules, and lets it run UI code a page sends it. The Soundor website uses it to let readers edit an example's code. The host shell also gains `clearMessages()`.

## 0.7.0

### Minor Changes

- [#146](https://github.com/soundor/soundor/pull/146) [`5637c03`](https://github.com/soundor/soundor/commit/5637c0368b45c7ef2a0896b7d3fee500525c9878) Thanks [@dm-balakin](https://github.com/dm-balakin)! - The Web host puts the plugin first: its view fills the page, with a floating dock (start audio, mute and volume, play/stop and the position) and a side panel, closed by default, for the transport, the audio source and format, editable parameters and, under `soundor dev`, the host state.

### Patch Changes

- [#145](https://github.com/soundor/soundor/pull/145) [`1d7eb63`](https://github.com/soundor/soundor/commit/1d7eb63cc2c4288f05e34bdfe7cfc5af82ad4ccf) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Centralize guides and package references in `docs/`, with a documentation index,
  page navigation, and package README links that also work on npm. Add a project
  README and guides covering the idea, architecture, getting started, project
  lifecycle, parameters, and contributing.

- [#147](https://github.com/soundor/soundor/pull/147) [`7aa583a`](https://github.com/soundor/soundor/commit/7aa583aa084e69c25ca5f75185a8d34be92db257) Thanks [@dm-balakin](https://github.com/dm-balakin)! - The Web host's UI is written in Preact (about 5 KB gzipped), independent of the plugin's own React. The runtime's Vite plugin optimizes Preact up front, so it loads once.

## 0.6.0

### Minor Changes

- [#138](https://github.com/soundor/soundor/pull/138) [`66210eb`](https://github.com/soundor/soundor/commit/66210eb00891368cf45d3847acb73e144d75c9d6) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `soundor dev` prints a summary when the runtime is ready (plugin, DevTools URL, and what the runtime adds), collapses the native build output into one progress line in a terminal (all of it is kept in `.soundor/dev/build.log`), and takes shortcuts: `o` opens DevTools signed in, `c` copies a signed-in link, `u` shows the summary again, `q` quits. Runtimes report readiness and add shortcuts through the new `ctx.session`; the JUCE runtime adds `s` to relaunch the Standalone, the Web runtime `w` to open the Web host.

## 0.5.2

### Patch Changes

- [#137](https://github.com/soundor/soundor/pull/137) [`ee85daa`](https://github.com/soundor/soundor/commit/ee85daa245fe5f71f2faa90eafb9b86db2f6026a) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Name the source repository and directory in every package, so npm links each package to its source and resolves its README's relative links.

## 0.5.1

### Patch Changes

- [#113](https://github.com/soundor/soundor/pull/113) [`9d8474e`](https://github.com/soundor/soundor/commit/9d8474ebfd40028eca8193a2bacaa248d17e3e5e) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Extract an isolated, framework independent testing runtime with semantic trees,
  input, services and deterministic animation time. Share the analytic spring solver
  with the Web runtime and preserve React tests through a temporary adapter.

  Make modal focus eligibility and pointer ownership deterministic, bound animation
  ownership without losing fills or replay, and fix native and simulated target
  capture propagation so stopPropagation preserves same-target bubble listeners.

## 0.5.0

### Minor Changes

- [#112](https://github.com/soundor/soundor/pull/112) [`2b03fd1`](https://github.com/soundor/soundor/commit/2b03fd19c2b52858b5f0b5573c5f483b64e17741) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add native springs with velocity-continuous retargeting, sequences, parallel and staggered programs, delays, repetition, directional keyframes, seeking and paint animations. Extend the existing React animation API and browser-owned Web Animation implementation without per-frame JavaScript callbacks.

- [#108](https://github.com/soundor/soundor/pull/108) [`b1a2699`](https://github.com/soundor/soundor/commit/b1a269977dccf753785bbbe123a799a4ec783e4b) Thanks [@dm-balakin](https://github.com/dm-balakin)! - **Breaking:** natively, plugin UIs run on Hermes, not QuickJS-NG: `eval()` and `new Function()` throw, private class members and `let`/`const` follow the lowered semantics below, and a call into JavaScript that runs past `juceRuntime({ timeLimit })` (5 s by default) is stopped. Runtime authors: the CLI's UI bundle context gains `ctx.ui.module` (the ES module) beside `ctx.ui.entry` (now the native CommonJS form), and the native `RuntimeStatistics` counts collections instead of allocations. The `soundor` CLI needs Node `^22.18.0 || >=24.11.0` (Babel 8).

  The JUCE runtime runs JavaScript on Hermes's interpreter instead of QuickJS-NG (no JIT; no Static Hermes). A built plugin embeds its UI bundle as Hermes bytecode, compiled at build time by the `hermesc` of the same pinned Hermes build, and links the VM without its compiler; `soundor dev` evaluates source and reloads as before. Hermes is built from source once per machine into Soundor's cache (several minutes, the first time), with hidden symbols, and its heap running out is an error instead of an abort: such a context fails from then on and is recreated on reload.

  Hermes has no ES modules, so the CLI now writes the UI bundle twice: `bundle.mjs`, the ES module the Web runtime loads (`ctx.ui.module`), and `bundle.js` (`ctx.ui.entry`), the native runtime's form: a CommonJS module function with classes, block scoping, private members, async functions and async generators lowered for Hermes by `@soundor/core`'s new `toNativeModule()` (Babel). `soundor:*` imports and application sources are unchanged.

  What changes for plugin code running natively: `eval()` and the `Function` constructors throw (a built plugin has no compiler, and `soundor dev` fails the same way), so code generated at run time needs a form made at build time; private class members are properties keyed by symbols of their own (fast, but visible to `Object.getOwnPropertySymbols()`, and unchecked: reading one on another object gives `undefined`); `let`/`const` have no temporal dead zone (reading one before its declaration gives `undefined`); on Linux, `localeCompare` and dates' `toLocaleString()` ignore the user's locale. Each context has a garbage-collector thread of Hermes's own. Built-ins Hermes lacks (FinalizationRegistry, `queueMicrotask`, Set methods, iterator helpers, `toSorted`, `Promise.withResolvers`, ArrayBuffer `transfer()`...) are provided; Atomics, SharedArrayBuffer, Float16Array, `Intl` and `Symbol.species` are not. `RuntimeStatistics` counts garbage collections (`collections`) instead of allocator calls.

  A UI script that never returns no longer freezes the host for good: `juceRuntime({ timeLimit })` (milliseconds, 5000 by default; `false`: none) bounds each call into JavaScript (a frame, an event, a timer, startup), past which the engine stops it with a `TimeoutError` JavaScript cannot catch; the error is logged and the context fails from then on, until the editor is opened again or `soundor dev` reloads. Natively, `RuntimeOptions::timeLimit` and `js::TimeLimitScope`. Native objects behind `soundor:native` handles are released on the UI thread, at the next tick after the collector finalizes their handles, never on the collector's own thread.

- [#111](https://github.com/soundor/soundor/pull/111) [`3fddefe`](https://github.com/soundor/soundor/commit/3fddefe972111f2948a684dca7d7bfc65a699a34) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add native timing animations for opacity and ordered transforms, playback controls,
  completion promises, declarative Animated.View transitions and browser Web Animations.

## 0.4.0

### Minor Changes

- [#94](https://github.com/soundor/soundor/pull/94) [`d9df7bf`](https://github.com/soundor/soundor/commit/d9df7bf9539b1483fa9e172dd0111a77eac463d6) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Canvas nodes and a 2D context. `createCanvas()` (and `<Canvas>` in `@soundor/react`) makes a node code draws on, with `width`/`height` and `getContext('2d')` as on the Web, plus the `devicePixelRatio`, `ImageData` and canvas globals. The JUCE runtime draws with Skia on the CPU: state and compositing, transforms, paths, line styles, gradients and patterns, text, `drawImage` and `ImageData`; what it does not draw yet (shadows, filters, `Path2D`) throws instead of drawing something else. The web runtime's canvas is a real `<canvas>`.

- [#97](https://github.com/soundor/soundor/pull/97) [`b3c6eeb`](https://github.com/soundor/soundor/commit/b3c6eeb76f7ed2a7c7d35c3b9d490845b19de87a) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Three.js's `WebGLRenderer` runs unmodified on Soundor's WebGL 2. The native tests cover it against the npm package, pinned. Nodes' styles can now be written one property at a time (`node.style.width = 120`, which is how Three's `setSize()` writes it), and lengths accept CSS pixels (`'120px'`), in both runtimes.

- [#95](https://github.com/soundor/soundor/pull/95) [`8118dab`](https://github.com/soundor/soundor/commit/8118dabc143da1313ae1b81a12f91a5083bdc834) Thanks [@dm-balakin](https://github.com/dm-balakin)! - WebGL 2 on canvas nodes. `getContext('webgl2')` gives a `WebGL2RenderingContext` in both runtimes, typed from the Khronos IDL. The JUCE runtime runs it on the GPU through ANGLE's WebGL-compatible OpenGL ES 3.0 context, so calls are validated as in a browser. It returns null where there is no hardware GPU, and the log says why. What it draws is read back into the canvas for now. Texture uploads take arrays, `ImageData` and canvas nodes. `getContext()` now returns null for types other than `'2d'` and `'webgl2'` in both runtimes, and the web runtime's contexts take canvas and image nodes wherever they take an image.

## 0.3.0

### Minor Changes

- [#81](https://github.com/soundor/soundor/pull/81) [`4f6615b`](https://github.com/soundor/soundor/commit/4f6615bb0a027d16557721203f5efaa77b930d85) Thanks [@dm-balakin](https://github.com/dm-balakin)! - **Breaking:** `pressable()`'s and `Pressable`'s `onPress` and `onLongPress` may now receive an `AccessibilityActionEvent` (assistive technology's `activate` and `longpress`) besides pointer and keyboard events.

  Accessibility semantics owned by Soundor. Components take React Native's accessibility props (`accessible`, `accessibilityLabel`, `accessibilityHint`, `accessibilityRole` — including `dialog` — `accessibilityState`, `accessibilityValue` with fractional values, `accessibilityActions`, `onAccessibilityAction`). `Pressable` is a button by default, labelled by its text, offering `activate` and reflecting `disabled`; `Modal` is a modal dialog (`accessibilityLabel`), and overlays opened from inside an overlay belong to it.

  `soundor:ui` nodes gain `accessibility`, `accessibilityParent` and the `accessibilityaction` event (`AccessibilityActionEvent`). The JUCE runtime's native core builds a platform-neutral semantic tree from the view (`a11y::SurfaceSemantics`: stable ids, incremental updates, modal scoping, implicit labels, safe action routing) for platform adapters to present; the web runtime checks the same properties.

- [#83](https://github.com/soundor/soundor/pull/83) [`4d0f1d4`](https://github.com/soundor/soundor/commit/4d0f1d4877d0c5d886e19f4ca183775e5a8ba7fc) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Soundor's accessibility semantics as ARIA in the browser, on the elements that already draw the nodes. Roles, labels (explicit, or the text inside a button-like element), hints, states and range values become ARIA attributes; text inputs and images keep their native semantics. A modal is an `aria-modal` dialog with everything outside it `aria-hidden`, nested modals supersede each other, and a portal opened from a modal is owned by it (`aria-owns`). A screen reader's activation (a click with no pointer) presses a `Pressable` once, through the `activate` accessibility action.

## 0.2.0

### Minor Changes

- [#75](https://github.com/soundor/soundor/pull/75) [`97db55f`](https://github.com/soundor/soundor/commit/97db55f43711e75a2e9886775aacf998c9f5b172) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Portals, and an overlay layer to render them in, inside the plugin's one view.

  - `soundor:ui` adds `overlayRoot`: a second root that fills the view, laid out apart from `root`, drawn over all of root's content whatever its `zIndex`, and hit first, letting the pointer through where nothing in it takes it. Its events bubble up to it, not to `root`. Tab moves through the content, then the overlay. The JUCE runtime draws both trees on its one Skia surface; the Web runtime keeps both in the plugin viewport, in one isolated stacking context.
  - `@soundor/react` adds `Portal`, `Portal.Host` and `createPortalHost()`, built on the reconciler's portals: React context, state and effects survive. `<Portal>` renders into an overlay entry; entries stack in the order they open, so an overlay opened from another stacks above it. `<Portal host={host}>` renders exactly where `<Portal.Host host={host}>` is, inheriting its clipping and stacking; it renders nothing until the host mounts, follows it away and back, and showing one host in two places is an error.
  - `FocusScope` covers both trees, so portaled content that a scope renders belongs to it.

- [#72](https://github.com/soundor/soundor/pull/72) [`64bdb5d`](https://github.com/soundor/soundor/commit/64bdb5d1b67ecc64e6c85d6f88c01ed44cf6c335) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `soundor:ui` gets the coordinates, stacking and interaction that overlays and custom controls build on, the same in the JUCE and Web runtimes.

  - Pointer events add `pageX`/`pageY` (relative to the plugin view) and `locationX`/`locationY` (relative to the target), in logical pixels at any device or viewport scale. `clientX`/`clientY` and `offsetX`/`offsetY` stay, with the same values.
  - `style.zIndex`: an integer that stacks a node among its siblings for drawing and hit testing alike (equal values keep tree order, the later sibling on top). Every node stacks its own children; layout is not affected.
  - A `contextmenu` pointer event, which captures and bubbles, when the secondary button goes down. In the browser it bridges the DOM's `contextmenu`; preventing it keeps the browser's own menu away. `@soundor/react` adds `onContextMenu` and `onContextMenuCapture`.
  - `pressable()` and `Pressable` add `onLongPress` (the primary button held `delayLongPress` ms, 500 by default, without moving more than 10 px; no `onPress` follows it), and their state adds `focused`, from focus and blur.

## 0.1.0

### Minor Changes

- [#58](https://github.com/soundor/soundor/pull/58) [`798acd0`](https://github.com/soundor/soundor/commit/798acd0622149accd5f06b2a8feb09c40cfb08a5) Thanks [@dm-balakin](https://github.com/dm-balakin)! - The Web host implements `soundor:ui`, `soundor:storage` and `soundor:fs`, so plugin UIs written with `@soundor/react` run in the browser unchanged.

  - `soundor:ui` draws with DOM elements in the host's plugin viewport; there is no ReactDOM. A stylesheet gives the DOM Yoga's defaults (flex columns that do not shrink, border-box sizes, no inherited text style), and styles are validated with the JUCE runtime's messages.
  - All five node types, the tree rules, `layout` and `getBoundingClientRect()` (in view coordinates, whatever the viewport's scale), focus and selection, scrolling, `pressable`, the clipboard (with an in-page fallback), `focusedNode()` and `viewSize()`.
  - Events capture and bubble along the Soundor tree, with UiNode targets. Input follows the JUCE runtime's rules: implicit pointer capture, hover enter and leave along the tree, a click to the deepest node holding both press and release, focus on press, Tab cycling, and the wheel scrolling the nearest scroll view. Text inputs edit natively and report `beforeinput`, `input` and `change`. All four `pointerEvents` modes are honored.
  - `soundor:storage` and `soundor:fs` keep their data in IndexedDB, one database per `plugin.id`, so plugins on one site never share data. `soundor:fs` is a private file tree: relative paths only, and the JUCE runtime's errors. Each write is atomic.
  - A failed Vite build now reports Vite's error instead of only the phase that failed.

- [#62](https://github.com/soundor/soundor/pull/62) [`ffd78ae`](https://github.com/soundor/soundor/commit/ffd78ae7d10afa799dc6a4aa5a44b8ad38c4a52f) Thanks [@dm-balakin](https://github.com/dm-balakin)! - The Web runtime is documented and proven on the example plugin.

  - `examples/basic` runs in the browser next to JUCE: the same config and the same `src/main.tsx`, with a `GainNode` in `runtimes/web/src/audio.ts` where JUCE applies the gain in C++. Its static build works below any path and in iframes, each with its own host, transport, audio and plugin view.
  - An integration test renders `@soundor/react` (View, Text, Pressable, TextInput, Image, ScrollView, reconciliation) on the DOM `soundor:ui`.
  - A dev server that cannot start reports Vite's error. A plugin without native methods is scaffolded `native = {}`.
  - The README covers the lifecycle, ownership, the Vite architecture, `soundor:*` in the browser, the native API, Web Audio, the host UI, static and iframe use, limitations, and the post-MVP DSP direction.

- [#56](https://github.com/soundor/soundor/pull/56) [`158c765`](https://github.com/soundor/soundor/commit/158c765bfdd348ee52fbd100919af950929c617e) Thanks [@dm-balakin](https://github.com/dm-balakin)! - New `@soundor/web-runtime`: runs a Soundor plugin in the browser, with Vite as its host and build system.

  - `webRuntime()` implements the five lifecycle phases. `init` scaffolds a user-owned Web host under `runtimes/web/` and never overwrites a file; it adds no `package.json` or lockfile there. `gen` emits a deterministic manifest (plugin identity and parameters). `dev` serves the host with Vite until stopped. `build` writes a static site with relative URLs to `.soundor/dist/web`. `doctor` checks Node.js, Vite and the scaffold.
  - `@soundor/web-runtime/vite` exports `defineWebConfig()` for the host's `vite.config.ts`, and `@soundor/web-runtime/client` exports `startSoundorWebHost()`.
  - `soundor:parameters`: one parameter store per page, shared by the plugin UI, the user's Web code and the host. It follows the JUCE runtime's semantics: numbers are clamped and ints rounded, a value of the wrong type is a `TypeError`, listeners hear of changes only, and gestures nest.
  - `soundor:host`: the host is "Soundor Web", with its audio format and a transport (play, pause, stop, tempo, time signature, a four-bar loop). Positions and bar starts honor the time signature's denominator, and subscribers get a snapshot every animation frame while it plays. The plugin observes the transport; only the host controls it.
  - The plugin UI is the bundle the CLI builds, loaded as it is: Vite never rebundles `src/main.tsx`. Its `soundor:*` imports resolve to the page's host modules, and its image assets are served and emitted under `soundor-assets/`. In `soundor dev`, a new `build-id` reloads the page (a failed build leaves it as it is), and the page's console appears in the terminal. A project without a UI gets an empty viewport.

- [#61](https://github.com/soundor/soundor/pull/61) [`ddcbdae`](https://github.com/soundor/soundor/commit/ddcbdae579e17e4b7d9ba84f2a72159e0173ef3c) Thanks [@dm-balakin](https://github.com/dm-balakin)! - The Web host implements `soundor:native` in TypeScript and gains Web Audio and a host UI.

  - `gen` emits `native.ts`, a `WebNativeApi` interface generated from the config's native API (primitives, binary types, arrays, structs, enums, handles, sync and async methods). A method added to the config is a type error in `runtimes/web/src/native.ts` until it is implemented. `soundor:native` calls that implementation directly: the same values, exceptions and promises, with no serialization. Handles are opaque objects made with each handle type's `wrap()`, and they cannot be forged.
  - `init` also scaffolds `src/native.ts` and `src/audio.ts`. `startSoundorWebHost({ native, audio })` loads them after the host exists.
  - The host owns one `AudioContext`, created from the user's first Play as browsers require. Its graph is source → input → the project's `setupAudio({ context, input, output })` → output → master volume. A missing or failing setup passes the input through. Sources are an oscillator, an audio file or none, and they play while the transport does. The transport follows the audio clock and reports the context's sample rate.
  - The host UI: play/pause, stop, loop, tempo, time signature, position, source, volume and mute, and the sample rate in the status bar. A plugin view too big for the page is scaled to fit, which helps in iframes. `soundor dev` adds an inspector of the host state and the parameters; builds show the clean demo.
