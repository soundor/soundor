# @soundor/juce-runtime

## 0.16.0

### Minor Changes

- [#252](https://github.com/soundor/soundor/pull/252) [`3275981`](https://github.com/soundor/soundor/commit/32759813fd8c6ef0f59fa10f7d2c2dc6e2f291a3) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Double clicks in the JUCE runtime: presses report JUCE's click count (`MouseEvent::getNumberOfClicks()`), which makes `event.detail` and `dblclick`, and the editor gives JUCE the platform's double-click time when it opens (`backend::useDoubleClickTime()`): macOS's and Windows' setting, the XSETTINGS `Net/DoubleClickTime` on Linux (GNOME's and KDE's), else JUCE's 400 ms.

- [#289](https://github.com/soundor/soundor/pull/289) [`a54e1da`](https://github.com/soundor/soundor/commit/a54e1da16a93c0097789c8e9e974632f4b12526c) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Expose plugin version and runtime environment in soundor:host, and extend host state with processing mode, sample precision, optional track metadata, loop boundaries and timecode. Rename snapshot/subscribe to getHostState/subscribeHostState. Configure plugin.version (default 0.1.0) consistently across formats.

- [#266](https://github.com/soundor/soundor/pull/266) [`496fe62`](https://github.com/soundor/soundor/commit/496fe623abcf179945db4b2df92f873cf399bb87) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Accept synchronous functional updaters on parameter and persistent state fields. Resolve once against the latest immutable store value, validate before publishing, and reject asynchronous results. Automatically bracket changed automatable parameter writes in a host gesture when no explicit gesture is active, preserving nested gestures and keeping state gestures explicit.

  Raise the runtime API version to 4 for the compatible setter addition; older runtime API versions remain supported.

- [#281](https://github.com/soundor/soundor/pull/281) [`0354f73`](https://github.com/soundor/soundor/commit/0354f730087bbde8a2f7ad34ca7595c373c20c20) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Native channels in C++: with `native.channels`, `SoundorNative.h` declares `soundor::native::Channels`, a `js::ValueChannel<T>` or `js::BufferChannel<T>` per channel, and the processor owns one as `nativeChannels`, which `process()` can publish to without locking or allocating (`nativeChannels.peak.publish(level)`, or `nativeChannels.spectrum.buffer()` filled in place, then `commit()`). Every open editor takes the newest value at its tick. `install()` takes the channels too (`install(context, api, events, channels)`, with what the config declares), and the editor installs them into every runtime.

- [#280](https://github.com/soundor/soundor/pull/280) [`27a3303`](https://github.com/soundor/soundor/commit/27a330313c40db624ef897111a5ab37a320f3ea0) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Native events in C++: with `native.events`, `SoundorNative.h` declares a struct per event in `soundor::native::events` and `soundor::native::Events`, one publisher per event, and the processor owns one as `nativeEvents`: `nativeEvents.presetLoaded({ .path = path })` from any thread but the audio callback, and every open editor receives it at its next tick. `install()` then takes the events too (`install(context, api, events)`, `api` nullptr when there are no methods), and the editor installs them into every runtime.

- [#255](https://github.com/soundor/soundor/pull/255) [`13da21d`](https://github.com/soundor/soundor/commit/13da21de509056defdaf7959cc7af78eb345ea1a) Thanks [@dm-balakin](https://github.com/dm-balakin)! - **Breaking:** the generated `soundor::native::NativeApi` uses the native API's exact types: `std::int8_t` … `std::uint64_t`, `float` and `double` for sized numbers, `std::optional<T>` for `T?`, `std::vector<T>` for `T[]`, and for `buffer<T>` a `std::span<const T>` argument (borrowed for the call) or a `std::vector<T>` elsewhere (results move into JavaScript without a copy). Handles, and their `std::shared_ptr<T>` base classes, are gone: a struct is a value.

- [#258](https://github.com/soundor/soundor/pull/258) [`553d8c4`](https://github.com/soundor/soundor/commit/553d8c430aab0c1e620dbd9d9be62448d41982f6) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Parameters run their compiled behavior as plain C++ (`SoundorParameters.cpp`), in a `JuceParameter`: hosts get the plugin's own mapping, steps and text, with the editor closed; manual parameters are not automatable and read-only ones are meters. The base processor has typed handles (`gainParameter.load()`, the declared C++ type; choice enums in `namespace choices`), and read-only parameters' `publish()`, lock-free on the audio thread.

- [#263](https://github.com/soundor/soundor/pull/263) [`14b7be0`](https://github.com/soundor/soundor/commit/14b7be04bb0262c6359ba08aac2087315f72d71f) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add typed persistent application state through `soundor:state`, reusing native type declarations and validated defaults, with field subscriptions and React `useStateValue()`.

  JUCE owns state per processor, saves parameters and state together, accepts legacy APVTS projects, and calls the protected `stateRestored()` hook on the message thread after each complete restoration. Off-thread host restorations queue to that thread. Web hydrates before application startup and automatically saves snapshots to application-namespaced IndexedDB. Runtime API 2 gates state configuration for older runtimes.

- [#288](https://github.com/soundor/soundor/pull/288) [`02d06a8`](https://github.com/soundor/soundor/commit/02d06a814f8fb77b2fd8fa78f73d0c8edc809ebd) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add boolean `soundor:ui` isVisible()/subscribeVisibility() and isFocused()/subscribeFocus() APIs so plugins can react to editor visibility and keyboard focus across runtimes. Add test runtime setters and Testing Library editor helpers. The analyzer example pauses its UI subscriptions while hidden.

- [#275](https://github.com/soundor/soundor/pull/275) [`258c891`](https://github.com/soundor/soundor/commit/258c8911cecc26d26e22c7bcc0d78d52dde66fc7) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Runtime packages now declare supported Soundor CLI versions through a required `soundor` peer dependency. Both first-party runtimes use a caret range matching their regular `@soundor/runtime-sdk` dependency; the SDK and CLI share the fixed package version. Before 1.0, this supports the current minor and its patches. Runtime providers own the supported range, and package managers handle peer mismatches without an additional CLI compatibility check.

  Remove the numeric `Runtime.apiVersion` and `ResolvedRuntime.apiVersion`, runtime API version constants and contract record, config-feature version gates, compatibility helpers, and `RuntimeCompatibilityError` with its dedicated error codes. Third-party runtimes should remove those imports and fields, keep the SDK as a regular dependency, and declare the supported CLI range in `peerDependencies.soundor`. The existing project config release-line check and cross-copy error protocol remain.

- [#264](https://github.com/soundor/soundor/pull/264) [`61798d1`](https://github.com/soundor/soundor/commit/61798d199d6c5a32d1f8118fba4f67184e280a13) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add optional beginGesture() and endGesture() methods to persistent state fields in JavaScript and native JUCE code. Gestures nest per field, leave writes immediate, reset on restoration, and clean up unfinished UI interactions without host automation or History recording.

  Raise the runtime API version to 3 for the additional state field methods; older runtimes remain accepted.

- [#267](https://github.com/soundor/soundor/pull/267) [`553076d`](https://github.com/soundor/soundor/commit/553076ddfee437804ce959495d967af8bd9081d2) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add processor-owned StateHistory with opt-in discrete edits, History-enabled parameter/state gestures, synchronous buffered transactions, undo/redo, subscriptions, and useStateHistory(). JavaScript and native C++ share one manager in JUCE; Web and simulated runtimes implement the same contract. History survives editor recreation and clears on project restoration. Runtime API 5 is now required so older runtimes cannot silently ignore History options.

- [#275](https://github.com/soundor/soundor/pull/275) [`6cfc628`](https://github.com/soundor/soundor/commit/6cfc628494cb431a15d98f50d7c696ba19a89348) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Narrow the `@soundor/vst3-host` peer dependency to a caret range matching the host release used for development, instead of accepting every pre-1.0 minor. This supports patches in the current minor without claiming compatibility with future breaking host API changes. The host remains optional for the Driver and JUCE runtime and required for Vitest E2E.

### Patch Changes

- [#283](https://github.com/soundor/soundor/pull/283) [`bca0307`](https://github.com/soundor/soundor/commit/bca0307e2d84550e484c62c91c859de4892f6e80) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Let CMake's Visual Studio generator discover MSVC on Windows, so doctor, dev and build accept installations without a compiler on PATH. Doctor reports that compiler validation happens at configure time.

- [#286](https://github.com/soundor/soundor/pull/286) [`6b97261`](https://github.com/soundor/soundor/commit/6b972614111ff48de5efa59b04a5ad5bad0eda49) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add native clang-tidy and no-GPU test presets for the JUCE adapters. CI checks the adapters and test plugin with GCC as well as Clang on Linux, and covers CPU rendering without ANGLE.

- [#287](https://github.com/soundor/soundor/pull/287) [`c7945b6`](https://github.com/soundor/soundor/commit/c7945b6e14d2c581ab5f6e10b590c78217e9278d) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add a native sanitizer preset for JUCE adapter, persistent-state and DevTools tests, with ASan, UBSan and leak detection. Apply sanitizer flags to the JUCE integration targets as well as the source engine.

- [#286](https://github.com/soundor/soundor/pull/286) [`6b97261`](https://github.com/soundor/soundor/commit/6b972614111ff48de5efa59b04a5ad5bad0eda49) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Limit Linux VST3 dynamic exports to the plugin entry points. This keeps GCC LTO's C++ standard-library instantiations private as well as the linked static runtime, preventing symbol collisions between plugins.

- [#282](https://github.com/soundor/soundor/pull/282) [`79a9ce5`](https://github.com/soundor/soundor/commit/79a9ce528fbe385a4f6fa0d3ed8bd1f34ee3c78c) Thanks [@dm-balakin](https://github.com/dm-balakin)! - State and History notifications are delivered inside the runtime's tick (`dispatchModules`), right after parameter changes and under the same time limit, instead of before it with a limit per callback. A state change is converted to JavaScript only when the field has a subscriber.

- [#256](https://github.com/soundor/soundor/pull/256) [`d5b9b16`](https://github.com/soundor/soundor/commit/d5b9b167c52bea1113785d84d62fb78e8409d06d) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Depends on one Soundor package, `@soundor/runtime-sdk`, which its code imports (instead of inlining it): no `@soundor/config` peer, and no `@soundor/core`. It implements runtime API 1, which the CLI checks before running it.

- [#262](https://github.com/soundor/soundor/pull/262) [`a01f12b`](https://github.com/soundor/soundor/commit/a01f12b2b9dff5e7687e258cc29738304f6f8466) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Show the active GPU or CPU compositor in an optional native debug-editor badge when SOUNDOR_SHOW_RENDERER=1.
- Updated dependencies [[`0ada0c5`](https://github.com/soundor/soundor/commit/0ada0c58f97b5a60ae76299895e98b0592051624), [`3275981`](https://github.com/soundor/soundor/commit/32759813fd8c6ef0f59fa10f7d2c2dc6e2f291a3), [`3275981`](https://github.com/soundor/soundor/commit/32759813fd8c6ef0f59fa10f7d2c2dc6e2f291a3), [`a54e1da`](https://github.com/soundor/soundor/commit/a54e1da16a93c0097789c8e9e974632f4b12526c), [`b35730c`](https://github.com/soundor/soundor/commit/b35730cb72b65ffbb7c730dd154e77b0d2af1ae8), [`9e809c3`](https://github.com/soundor/soundor/commit/9e809c326f4897f59a995bc6c8ed86d4ea99b83c), [`496fe62`](https://github.com/soundor/soundor/commit/496fe623abcf179945db4b2df92f873cf399bb87), [`79a9ce5`](https://github.com/soundor/soundor/commit/79a9ce528fbe385a4f6fa0d3ed8bd1f34ee3c78c), [`0354f73`](https://github.com/soundor/soundor/commit/0354f730087bbde8a2f7ad34ca7595c373c20c20), [`27a3303`](https://github.com/soundor/soundor/commit/27a330313c40db624ef897111a5ab37a320f3ea0), [`13da21d`](https://github.com/soundor/soundor/commit/13da21de509056defdaf7959cc7af78eb345ea1a), [`6b97261`](https://github.com/soundor/soundor/commit/6b972614111ff48de5efa59b04a5ad5bad0eda49), [`d5b9b16`](https://github.com/soundor/soundor/commit/d5b9b167c52bea1113785d84d62fb78e8409d06d), [`553d8c4`](https://github.com/soundor/soundor/commit/553d8c430aab0c1e620dbd9d9be62448d41982f6), [`553d8c4`](https://github.com/soundor/soundor/commit/553d8c430aab0c1e620dbd9d9be62448d41982f6), [`14b7be0`](https://github.com/soundor/soundor/commit/14b7be04bb0262c6359ba08aac2087315f72d71f), [`6b97261`](https://github.com/soundor/soundor/commit/6b972614111ff48de5efa59b04a5ad5bad0eda49), [`67ffaac`](https://github.com/soundor/soundor/commit/67ffaacba3038901877563c40af773dfc2122e7d), [`02d06a8`](https://github.com/soundor/soundor/commit/02d06a814f8fb77b2fd8fa78f73d0c8edc809ebd), [`8e94ab3`](https://github.com/soundor/soundor/commit/8e94ab3a19379d4b9b4600def58b15e3d316a447), [`258c891`](https://github.com/soundor/soundor/commit/258c8911cecc26d26e22c7bcc0d78d52dde66fc7), [`79ccdf6`](https://github.com/soundor/soundor/commit/79ccdf6244414b0076dcaf6da47cd0bda02aacc8), [`553076d`](https://github.com/soundor/soundor/commit/553076ddfee437804ce959495d967af8bd9081d2), [`87ce3c9`](https://github.com/soundor/soundor/commit/87ce3c902a6a8c9e734ea65dd716019631c6b820), [`3a778e2`](https://github.com/soundor/soundor/commit/3a778e22214860be850efe603802a955f3fdda52)]:
  - @soundor/engine@0.8.0
  - soundor@0.17.0
  - @soundor/runtime-sdk@0.17.0

## 0.15.1

### Patch Changes

- Updated dependencies [[`cad49d2`](https://github.com/soundor/soundor/commit/cad49d2841d692bf274a1e9b62a619163e0c09e7)]:
  - @soundor/engine@0.7.1

## 0.15.0

### Minor Changes

- [#215](https://github.com/soundor/soundor/pull/215) [`9e4c0ef`](https://github.com/soundor/soundor/commit/9e4c0efa87a2743965921a0590c61f161faeb0bf) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add `soundor build juce --debug`: a one-shot Debug build with DevTools and the UI embedded, for tests, in `.soundor/debug/juce/<format>/`. Add `--out <dir>` to `soundor build`, for releases and debug builds.

- [#222](https://github.com/soundor/soundor/pull/222) [`7fb3f13`](https://github.com/soundor/soundor/commit/7fb3f13f2e3435764e0c5c84ba0b2c44ef805430) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `soundor dev juce` opens the VST3 in `@soundor/vst3-host`, now an optional peer, when the project installs it and `formats` has `vst3`; otherwise the Standalone, as before. `juceRuntime({ dev: { launch } })` chooses (`'vst3'`, `'standalone'` or `false`), and the `v` and `s` keys open either at any time. The plugin's state is kept in `.soundor/state/juce/vst3.json` between launches of the host. New projects with the JUCE runtime get the host as a devDependency. In the host, `launchHost({ detached: true })` runs it in a process group of its own, so that a terminal's Ctrl+C reaches only Node. Runtimes get `ctx.paths.state`, `.soundor/state/<id>`, for what they keep between sessions and cannot make again. A local build of the host no longer needs a static libstdc++ (Fedora's `libstdc++-static`); only the published executables link it.

- [#224](https://github.com/soundor/soundor/pull/224) [`e30a086`](https://github.com/soundor/soundor/commit/e30a08690b7d67da02fe73296cfb55e22fafa6a3) Thanks [@dm-balakin](https://github.com/dm-balakin)! - On Linux, every plugin build and every build of the VST3 host links the C++ runtime statically, and a plugin's is hidden from other plugins, so a plugin no longer needs a `libstdc++` as new as its build machine's, and needs neither `libatomic` nor, as a VST3, `libasound`. A build machine now needs the compiler's static C++ library (Fedora, RHEL: `libstdc++-static`): without it, a build stops first and says what to install, and `soundor doctor` reports it. `soundor build` prints the glibc a release needs, and `soundor doctor` warns when the machine's is newer than the 2.39 of Ubuntu 24.04, as a release built there may not load on older systems.

- [#223](https://github.com/soundor/soundor/pull/223) [`5f9a5a3`](https://github.com/soundor/soundor/commit/5f9a5a33ef84f916d4b295a91b6ca0bc1343f50e) Thanks [@dm-balakin](https://github.com/dm-balakin)! - A JUCE plugin now runs on macOS 12 or later by default, whatever macOS it is built on, where it used to require the macOS of the machine that built it. `juceRuntime({ macos: { deploymentTarget } })` asks for a newer minimum, and anything below the engine's 12.0 is refused. `soundor doctor` checks for the Metal tools a source build of the engine needs. A prebuilt macOS engine no longer lists a framework by its path inside the Xcode that built it. Source builds of the VST3 host target macOS 12 too, as its published executables do.

- [#226](https://github.com/soundor/soundor/pull/226) [`2f7cdc3`](https://github.com/soundor/soundor/commit/2f7cdc36b8a5fdfdec0f1113ff901d2463007659) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Windows plugins now include the C runtime by default (`/MT`, and `/MTd` in Debug), so users need no Visual C++ Redistributable, and an older runtime loaded by a host cannot crash them. `juceRuntime({ windows: { crt: 'MD' } })` keeps the DLL runtime, for a library that only comes built that way. The engine builds Skia, ANGLE and Hermes for the runtime in use, and Windows has `debug-static` and `release-static` prebuilt archives beside `debug` and `release`. Prebuilt engines are now built with MSVC 19.44, so Visual Studio 2022 17.14 or newer can link them, and an older one stops with a message saying so. Skia builds with the project's MSVC on Windows, rather than the newest installed.

### Patch Changes

- [#212](https://github.com/soundor/soundor/pull/212) [`aa91eeb`](https://github.com/soundor/soundor/commit/aa91eebfa3106d0356e533afedc4c4a45964c5b5) Thanks [@dm-balakin](https://github.com/dm-balakin)! - List parameters in the order the config declares them, as the web host does, rather than sorted by id. Apply `requestEditorSize()` at most once a frame, on the UI timer, rather than per input event, which starved the host's thread during a fast drag. Present only completed CPU-rendered frames from native paint callbacks. The UI timer settles JavaScript updates before rendering at the new editor size, preventing mixed-layout images during native resizing and expose events. Scale-mode editors retain raster density while their size keeps changing and sharpen after a short pause, avoiding repeated canvas allocations, with no round trip on the X connection each frame, which could leave a click waiting for the next event.

- [#209](https://github.com/soundor/soundor/pull/209) [`2319596`](https://github.com/soundor/soundor/commit/231959689c554d2e3901cc930b7f97350f88d546) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Enable the DevTools bridge in all Debug plugin formats, including hosted VST3 and AU plugins, when SOUNDOR_DEVTOOLS_SESSION is provided.

- [#210](https://github.com/soundor/soundor/pull/210) [`ac3af22`](https://github.com/soundor/soundor/commit/ac3af2206db1ec4a160ae104d601c3506f2a548b) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Select engine prebuilts automatically when native build inputs match, including in the workspace. Compile local changes from source, verify input fingerprints on imported CI artifacts, and resolve immutable release metadata by the exact engine package version.
- Updated dependencies [[`9646c34`](https://github.com/soundor/soundor/commit/9646c34f84a94ead9c36724bf28984a1743d6189), [`ede9005`](https://github.com/soundor/soundor/commit/ede90051c20216a7543fcf0b8336f3bf8630eec5), [`ac3af22`](https://github.com/soundor/soundor/commit/ac3af2206db1ec4a160ae104d601c3506f2a548b), [`8a8f912`](https://github.com/soundor/soundor/commit/8a8f912207d8b1d61832ad7042c63fc395fdb729), [`079d0a5`](https://github.com/soundor/soundor/commit/079d0a5bc152b983de7ef96c431c91dca683ef7d), [`ca0158b`](https://github.com/soundor/soundor/commit/ca0158b66bafff553e878c642f3b33aff25942c9), [`6279a4b`](https://github.com/soundor/soundor/commit/6279a4b5bd244a8b0ae9c6b6acb927764e4ea8f3), [`7fb3f13`](https://github.com/soundor/soundor/commit/7fb3f13f2e3435764e0c5c84ba0b2c44ef805430), [`5f9a5a3`](https://github.com/soundor/soundor/commit/5f9a5a33ef84f916d4b295a91b6ca0bc1343f50e), [`7d8b5a5`](https://github.com/soundor/soundor/commit/7d8b5a5153ed988c138376688b7a492665fad8dd), [`dee92f6`](https://github.com/soundor/soundor/commit/dee92f672cd91be4df9436807317fb28fbf24d5a), [`dee92f6`](https://github.com/soundor/soundor/commit/dee92f672cd91be4df9436807317fb28fbf24d5a), [`2f7cdc3`](https://github.com/soundor/soundor/commit/2f7cdc36b8a5fdfdec0f1113ff901d2463007659), [`da1a05c`](https://github.com/soundor/soundor/commit/da1a05c258489f948d4023dd7dda59aa9e1a1f6f)]:
  - @soundor/engine@0.7.0
  - @soundor/core@0.16.0

## 0.14.0

### Minor Changes

- [#201](https://github.com/soundor/soundor/pull/201) [`54ed098`](https://github.com/soundor/soundor/commit/54ed098e0c0aeb21665057b03ff26fb95195c2cc) Thanks [@dm-balakin](https://github.com/dm-balakin)! - A resizable editor's limits are now what it asks for. By default it opens at its size and only grows, without a maximum: `minWidth`/`minHeight` default to the opening size, and `maxWidth`/`maxHeight` to `Infinity` (which a config may also write). The limits, and the aspect ratio of an editor that scales (`editor.keepAspectRatio`, default `true`), are offered to hosts that ask and kept by the Standalone and the web host's handle; a host that sets a larger window or another shape regardless (Ardour) gets it, the minimum only held. `editor.fit` decides what the UI does in such a window, for every resizable editor: `'contain'`, the default, lays it out at most at its maximum (or, scaling, at its zoom, capped by the maximum) in the middle, with bands of the editor's background; `'cover'` lays it out over the whole window, `viewSize().safeArea` (and `useViewSize()`) saying where the part it was made for is. The web host applies the same rules in `?embed`, where the page owns the size, and hides its handle where the limits allow no other size. `soundor:ui` adds `editorSize()` and `subscribeEditorSize()`, the editor's actual size in its own logical pixels, told once per change whoever resized it. `EditorConfig` is now a union that allows `fit` only with `resizable: true` and `keepAspectRatio` only with `resize: 'scale'` (validation rejects `fit: 'cover'` and `keepAspectRatio: true` elsewhere), and reports a maximum below the opening size; `ResolvedEditorConfig` always has both, and `DEFAULT_EDITOR_LIMITS` is gone. In tests, `testView.resize({ safeArea })` sets the safe area and `testEditor.resize()` the editor's size.

- [#201](https://github.com/soundor/soundor/pull/201) [`bffc8ea`](https://github.com/soundor/soundor/commit/bffc8ea6d3a1d00bc3977d3a7f1765ff926447a0) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `soundor:ui` gains `requestEditorSize(width, height)`: plugin code asks for another editor size, any finite one, held to the editor's limits (and, scaling, its aspect ratio), which the host gives or not; it returns the size asked of the host, or `null` where none can be; `editorSize().resizable` says whether it can ask (false for a fixed editor and in `?embed`). Pointer events gain `screenX`/`screenY`, the pointer on the screen in the editor's pixels, so a resize grip drawn by the UI measures its drag in units the resize does not change. The JUCE editor applies requests with `setSize()` after the UI's code ran, telling the host, and keeps later requests to a minimum or maximum the host showed by giving another size in place of one asked for (Ardour's window), so a grip does not spring back at every step; the Web host resizes its viewport as its handle does. The test runtime simulates requests (`testEditor.requests()`, `editor: { resizable, minWidth, …, aspectRatio, applyRequests }`). An editor that scales keeping its aspect ratio is given the size at its ratio nearest to the one asked for, by a request or by the Web host's handle, whatever its size is, so a corner dragged narrower and taller no longer grows and shrinks in turn. The Basic and Orbit examples draw a grip of their own.

- [#193](https://github.com/soundor/soundor/pull/193) [`36e2599`](https://github.com/soundor/soundor/commit/36e2599acb42049a8b129055faf150af2e72874e) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `editor.resize: 'scale'` makes a resizable editor zoom rather than lay its UI out again: the UI stays laid out at `width`×`height`, and resizing draws it larger or smaller, keeping its aspect ratio (default limits: half and twice the size). In JUCE the editor offers its aspect ratio to the host (and keeps it in the Standalone), takes whatever shape a host that ignores it gives (Ardour) with the UI letterboxed in the middle, and draws the surface at the zoom, converting pointer, wheel, pointer lock and accessibility coordinates; in the web host the handle sets the zoom, and `embed` fills the iframe at the editor's layout. `useViewSize()` keeps `width` and `height` and reports the zoom in `scale`. The default, `resize: 'layout'`, is unchanged.

- [#186](https://github.com/soundor/soundor/pull/186) [`a71ac96`](https://github.com/soundor/soundor/commit/a71ac965bb43686143991a875cf162daed1cdc3b) Thanks [@dm-balakin](https://github.com/dm-balakin)! - A config's `editor` sets the plugin editor's size, the same in every runtime: `width` and `height` (800×600 by default), and with `resizable: true` limits the user can resize it within (`minWidth`, `minHeight`, `maxWidth`, `maxHeight`; 480×320 to 1600×1200 by default). Without it, an editor is a fixed 800×600 view as before. `resolveEditor()` gives a runtime every field decided. The JUCE runtime's generated editor opens at that size and, when resizable, lets the host resize it within its limits; the UI is laid out again at the new size, and under the GPU compositor presented at it at once.

### Patch Changes

- [#205](https://github.com/soundor/soundor/pull/205) [`ecb42d5`](https://github.com/soundor/soundor/commit/ecb42d535f03b806c69d3fe9abdc1c1be917d0c3) Thanks [@dm-balakin](https://github.com/dm-balakin)! - On Linux, the default cursor over a plugin's view is now the cursor theme's arrow rather than whatever the host's window shows: JUCE's normal cursor is no cursor of the view's own on X11, so a cursor the host left on its window (Ardour's resize cursor after resizing it) stayed over the plugin once the UI's own cursor went back to `default`.
- Updated dependencies [[`54ed098`](https://github.com/soundor/soundor/commit/54ed098e0c0aeb21665057b03ff26fb95195c2cc), [`bffc8ea`](https://github.com/soundor/soundor/commit/bffc8ea6d3a1d00bc3977d3a7f1765ff926447a0), [`2a5caa9`](https://github.com/soundor/soundor/commit/2a5caa9156a2335de3490835886d19734fd64e66), [`c0420b2`](https://github.com/soundor/soundor/commit/c0420b2f70d747959292c7d1f7feac7db089268d), [`003c103`](https://github.com/soundor/soundor/commit/003c103191eb4bec37df0aca7bad4d8e3fbdbe4f), [`6a5482e`](https://github.com/soundor/soundor/commit/6a5482e4a62036fbe9c3b0fa2e530adac503361f), [`6a677ac`](https://github.com/soundor/soundor/commit/6a677ac5d2d56b31f2101435ff6d3b69f31108db), [`96ef938`](https://github.com/soundor/soundor/commit/96ef938d7c0fc4dc745168a7083566400250a4a8)]:
  - @soundor/engine@0.6.0
  - @soundor/core@0.15.0

## 0.13.0

### Minor Changes

- [#180](https://github.com/soundor/soundor/pull/180) [`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Projects no longer list `@soundor/core`. It is now a regular dependency of every package that imports it, instead of a peer dependency the project had to provide. The CLI, `@soundor/config`, `@soundor/runtime-sdk` and `@soundor/vitest` pin the exact version their release group shares, so a project still gets one copy. The runtimes take it with a caret range. New projects from `create-soundor-app` no longer include it, and an existing project can remove it from its `devDependencies`.

- [#184](https://github.com/soundor/soundor/pull/184) [`2a4f506`](https://github.com/soundor/soundor/commit/2a4f506dd54207a927aeccf4dc1267b0a2ebfe2c) Thanks [@dm-balakin](https://github.com/dm-balakin)! - A `cursor` style sets the pointer's shape over a node and its children: `'auto'` (the default, the parent's: the arrow at the root, the I-beam in a text input), `'default'`, `'none'`, `'pointer'`, `'text'`, `'crosshair'`, `'move'`, and the `'ew-'`, `'ns-'`, `'nesw-'` and `'nwse-resize'` cursors. While a pointer is pressed, the pressed node's cursor shows wherever it is dragged. Both runtimes resolve it the same way; the JUCE runtime shows the platform's own cursors.

  Hover follows what changes under a pointer that does not move, as in browsers: when the tree, a layout or a scroll puts another node under a still mouse, `pointerleave` and `pointerenter` fire (and Pressable's `onHoverIn`/`onHoverOut`), and the cursor follows, in the next tick or frame.

- [#185](https://github.com/soundor/soundor/pull/185) [`be7853c`](https://github.com/soundor/soundor/commit/be7853cc5ccbc2e402abb0dc42fe2a99a121e5dd) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Pointer events have `movementX`/`movementY`: how far the pointer moved since its previous event, in logical pixels. A node can lock the pointer while it is pressed, for knobs and faders that turn past the screen's edge: `node.requestPointerLock()` (from `pointerdown`) hides the pointer, the screen's edges no longer stop it, its events stay at the position the lock began with only the movement changing, and on release (or `exitPointerLock()`) the pointer shows again where it began. `pointerLockNode()` is the node holding it. The JUCE runtime keeps the hidden pointer in the view, moving it back as it strays, and ends the lock however the press ends; the web runtime uses the browser's Pointer Lock. The implicit pointer capture now starts before the `pointerdown` listeners run, so they can lock the press. The test runtime and `user.pointer` support both.

- [#180](https://github.com/soundor/soundor/pull/180) [`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba) Thanks [@dm-balakin](https://github.com/dm-balakin)! - The runtime that runs another form of the UI now makes that form itself. The CLI bundles the UI into one ES module, `bundle.mjs`. The JUCE runtime lowers it for Hermes with the `toNativeModule()` of the engine it links (`@soundor/engine/native-module`), into `.soundor/cache/juce/ui-debug` or `ui-release`. The lowering therefore always matches the plugin's engine, and a web-only project no longer pays for it.

  `ctx.ui.entry` is removed. In `soundor dev`, `ctx.ui.live` gains `onBuild(listener)` and `sourceMap(file, mapFile)`, so that a runtime can remake its form after every build and have its stack frames mapped. `@soundor/core` no longer depends on `@soundor/engine` and no longer exports `toNativeModule()`; import it from `@soundor/engine/native-module`.

### Patch Changes

- Updated dependencies [[`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba), [`2a4f506`](https://github.com/soundor/soundor/commit/2a4f506dd54207a927aeccf4dc1267b0a2ebfe2c), [`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba), [`be7853c`](https://github.com/soundor/soundor/commit/be7853cc5ccbc2e402abb0dc42fe2a99a121e5dd), [`4588cca`](https://github.com/soundor/soundor/commit/4588cca3b50a0db869c8d220408dbf23c477f1f2), [`ce7601d`](https://github.com/soundor/soundor/commit/ce7601d1df6706d3d8957bb84247fee5568bd530), [`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba), [`2e2080e`](https://github.com/soundor/soundor/commit/2e2080e0e9d45ba6fa77a0ff4449b6db51fe25e8)]:
  - @soundor/core@0.14.0
  - @soundor/engine@0.5.0

## 0.12.0

### Minor Changes

- [#164](https://github.com/soundor/soundor/pull/164) [`f75bc0c`](https://github.com/soundor/soundor/commit/f75bc0ca9a76077bdb9b3e7df28cfa5d3b3dbab2) Thanks [@dm-balakin](https://github.com/dm-balakin)! - DevTools targets have no owner any more: every signed-in client (dashboard tabs, Soundor Driver, `soundor driver`) reads, highlights, picks, records and sends input at the same time, as several mice and keyboards share one computer. The engine keeps each client's synthetic pointer, held keys, highlight and picker apart, draws every client's highlight, and releases only a client's own input when it disconnects. The performance recording is shared and stops once every client that started it is gone.

  Breaking: the protocol is version 2. `Control.acquire`/`Control.release`, `LEASE_BUSY`/`LEASE_REQUIRED` and targets' `controller` are removed; runtime requests carry the sending `client`, and `resetControl` is replaced by `clientGone`. The Driver drops `acquireControl()`, `releaseControl()` and `hasControl`; the dashboard drops **Request control**; `soundor driver` exit code 6 now means the target is busy.

### Patch Changes

- [#171](https://github.com/soundor/soundor/pull/171) [`b070f8e`](https://github.com/soundor/soundor/commit/b070f8e31933663f7a42137e9751122198ad7ab1) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Recreate the plugin build directory when it was configured with another JUCE checkout, instead of failing in JUCE's juceaide sub-build.
- Updated dependencies [[`f75bc0c`](https://github.com/soundor/soundor/commit/f75bc0ca9a76077bdb9b3e7df28cfa5d3b3dbab2), [`cc32cc8`](https://github.com/soundor/soundor/commit/cc32cc87207b9600fe88dc5037b302fd75fbc34b), [`639ac93`](https://github.com/soundor/soundor/commit/639ac93e6d0ef80d6aa5d34dc01e3fcd2bfd190e)]:
  - @soundor/engine@0.4.0

## 0.11.0

### Minor Changes

- [#163](https://github.com/soundor/soundor/pull/163) [`e02159e`](https://github.com/soundor/soundor/commit/e02159eb8eb68a989a4dea8f405efdca9dff7798) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Soundor Driver screenshots: the engine captures its view as it renders it, as PNG (`capture` capability, `Capture.screenshot`), and the JUCE bridge uploads it to the DevTools server as binary, which keeps it as a short-lived capture clients read with their session cookie (bounded in size, number and lifetime). `driver.screenshot()`, `locator.screenshot()` and `soundor driver screenshot <path>` save it; DevTools previews and downloads it. Locators gain `waitFor()` and `isVisible()`, and a missing debug ID lists the ones there are.

- [#162](https://github.com/soundor/soundor/pull/162) [`3fe72a1`](https://github.com/soundor/soundor/commit/3fe72a188cef8f8a1b9eb4f49d5107cf41ac4096) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Soundor Driver input: the engine dispatches synthetic pointer, wheel and keyboard input through its own hit testing, capture and event dispatch (`input` capability; `Input.dispatchPointer`, `dispatchWheel`, `dispatchKey`, `typeText`, `focus` and `UI.hitTest` in the DevTools protocol), on a pointer of its own, and releases whatever it holds when control is released, the client goes or the UI reloads. `@soundor/driver` adds `pointer`, `keyboard`, control leases and locator actions (`click`, `hover`, `drag`, `dragTo`, `scroll`, `focus`, `press`, `type`) that wait until a node is actionable; `soundor driver` adds `click`, `hover`, `focus`, `move`, `drag`, `scroll`, `key` and `type`; DevTools offers Click, Hover and Focus on the selected node. The engine decodes runtime commands itself, and `Surface::key(input, typed)` is the shared key entry of the JUCE editor and synthetic input.

### Patch Changes

- Updated dependencies [[`e02159e`](https://github.com/soundor/soundor/commit/e02159eb8eb68a989a4dea8f405efdca9dff7798), [`3fe72a1`](https://github.com/soundor/soundor/commit/3fe72a188cef8f8a1b9eb4f49d5107cf41ac4096), [`4974b0d`](https://github.com/soundor/soundor/commit/4974b0dfbd49c801d61488341d6fa05d4c8b3239)]:
  - @soundor/engine@0.3.0

## 0.10.2

### Patch Changes

- Updated dependencies [[`e423f17`](https://github.com/soundor/soundor/commit/e423f17f789e8eb69cc3cf3c524b0c6e28cae174)]:
  - @soundor/engine@0.2.2

## 0.10.1

### Patch Changes

- [#145](https://github.com/soundor/soundor/pull/145) [`1d7eb63`](https://github.com/soundor/soundor/commit/1d7eb63cc2c4288f05e34bdfe7cfc5af82ad4ccf) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Centralize guides and package references in `docs/`, with a documentation index,
  page navigation, and package README links that also work on npm. Add a project
  README and guides covering the idea, architecture, getting started, project
  lifecycle, parameters, and contributing.

- [#142](https://github.com/soundor/soundor/pull/142) [`4f1dce8`](https://github.com/soundor/soundor/commit/4f1dce86003d76ea94ee50c11ec5fad05b312d87) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Plugin builds compile in parallel with Visual Studio too: `soundor dev` and `soundor build` pass `--parallel` to `cmake --build` (MSBuild otherwise builds one project at a time), and the engine's targets compile with `/MP` under the Visual Studio generator (cl.exe otherwise compiles a project's sources one at a time). Ninja builds were already parallel. The engine's `tidy` build can remember clang-tidy's passes in a directory (`SOUNDOR_CLANG_TIDY_CACHE`), so files whose source, headers and configuration are unchanged are not analyzed again.
- Updated dependencies [[`1d7eb63`](https://github.com/soundor/soundor/commit/1d7eb63cc2c4288f05e34bdfe7cfc5af82ad4ccf), [`4f1dce8`](https://github.com/soundor/soundor/commit/4f1dce86003d76ea94ee50c11ec5fad05b312d87)]:
  - @soundor/engine@0.2.1

## 0.10.0

### Minor Changes

- [#138](https://github.com/soundor/soundor/pull/138) [`66210eb`](https://github.com/soundor/soundor/commit/66210eb00891368cf45d3847acb73e144d75c9d6) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `soundor dev` prints a summary when the runtime is ready (plugin, DevTools URL, and what the runtime adds), collapses the native build output into one progress line in a terminal (all of it is kept in `.soundor/dev/build.log`), and takes shortcuts: `o` opens DevTools signed in, `c` copies a signed-in link, `u` shows the summary again, `q` quits. Runtimes report readiness and add shortcuts through the new `ctx.session`; the JUCE runtime adds `s` to relaunch the Standalone, the Web runtime `w` to open the Web host.

## 0.9.0

### Minor Changes

- [#131](https://github.com/soundor/soundor/pull/131) [`99053ab`](https://github.com/soundor/soundor/commit/99053abfa9dc615ff9b81d6e2ec668e3d392288f) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Extract the backend-independent native engine into its own source package. Resolve it through normal package resolution, expose Soundor::Engine, and derive the C++ ABI from its exact version. Keep Apple class registration in a small shim compiled per plugin binary and preserve unloading protections.

  Move Hermes module lowering into the engine and preserve the core re-export, so ordinary core releases do not cascade into engine versions. Preserve exact stored JUCE float values when reading parameters, avoiding a lossy normalized round trip on platforms with fused floating-point arithmetic.

- [#136](https://github.com/soundor/soundor/pull/136) [`092442e`](https://github.com/soundor/soundor/commit/092442ee4067a2bef6dccecbf19d4f61a4b8fe22) Thanks [@dm-balakin](https://github.com/dm-balakin)! - JUCE plugins link the prebuilt engine by default: `juceRuntime({ engine: { mode: 'prebuilt' } })` downloads the Debug or Release libraries of the installed engine's prebuilt release for the platform the plugin targets into the Soundor cache, verifies their SHA-256 and reuses them offline; `{ mode: 'source' }` compiles the engine as before. Prebuilt mode never falls back to compiling: an engine without a release (a workspace or unpublished copy), an unsupported target or a failed download stops the configure, naming source mode. The published engine names its release in `artifacts/manifest.json`. `soundor doctor` reports the engine a build will use. The JUCE DevTools bridge compiles into every plugin and is active only with a DevTools engine.

### Patch Changes

- [#137](https://github.com/soundor/soundor/pull/137) [`ee85daa`](https://github.com/soundor/soundor/commit/ee85daa245fe5f71f2faa90eafb9b86db2f6026a) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Name the source repository and directory in every package, so npm links each package to its source and resolves its README's relative links.
- Updated dependencies [[`99053ab`](https://github.com/soundor/soundor/commit/99053abfa9dc615ff9b81d6e2ec668e3d392288f), [`092442e`](https://github.com/soundor/soundor/commit/092442ee4067a2bef6dccecbf19d4f61a4b8fe22), [`9b710e2`](https://github.com/soundor/soundor/commit/9b710e2ec774df35c636f7429393e0c5b9de3b7f), [`ee85daa`](https://github.com/soundor/soundor/commit/ee85daa245fe5f71f2faa90eafb9b86db2f6026a)]:
  - @soundor/engine@0.2.0

## 0.8.0

### Minor Changes

- [#127](https://github.com/soundor/soundor/pull/127) [`640fca8`](https://github.com/soundor/soundor/commit/640fca812d39e560c89494b645169e0377df7e32) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Expose real native animation snapshots and bounded lifecycle events, plus explicit performance recording of measured UI tick, layout, raster, frame and compositor work. Add animation and performance panels to DevTools with controller-only recording and safe reload/disconnect cleanup. Keep inspection read-only where reconciler-safe property overrides or source metadata are unavailable.

- [#122](https://github.com/soundor/soundor/pull/122) [`04ff5cf`](https://github.com/soundor/soundor/commit/04ff5cf759658cfda0f0ee748f1287fd29ee9848) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add optional runtime DevTools capabilities, development connection context and validated platform-specific user settings. Discover DevTools support before development without requiring existing runtimes to change.

- [#124](https://github.com/soundor/soundor/pull/124) [`2807b91`](https://github.com/soundor/soundor/commit/2807b91593c45278d51e400892b399368e1f55c7) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Connect JUCE development Standalones to the designated DevTools session through asynchronous authenticated IPC. Inspect actual native nodes, styles, layout, accessibility and focus, render independent CPU/GPU highlight layers, and intercept native picker clicks safely across disconnects and reloads. Exclude the bridge from production builds.

### Patch Changes

- [#113](https://github.com/soundor/soundor/pull/113) [`9d8474e`](https://github.com/soundor/soundor/commit/9d8474ebfd40028eca8193a2bacaa248d17e3e5e) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Extract an isolated, framework independent testing runtime with semantic trees,
  input, services and deterministic animation time. Share the analytic spring solver
  with the Web runtime and preserve React tests through a temporary adapter.

  Make modal focus eligibility and pointer ownership deterministic, bound animation
  ownership without losing fills or replay, and fix native and simulated target
  capture propagation so stopPropagation preserves same-target bubble listeners.

## 0.7.0

### Minor Changes

- [#112](https://github.com/soundor/soundor/pull/112) [`2b03fd1`](https://github.com/soundor/soundor/commit/2b03fd19c2b52858b5f0b5573c5f483b64e17741) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add native springs with velocity-continuous retargeting, sequences, parallel and staggered programs, delays, repetition, directional keyframes, seeking and paint animations. Extend the existing React animation API and browser-owned Web Animation implementation without per-frame JavaScript callbacks.

- [#107](https://github.com/soundor/soundor/pull/107) [`a907c25`](https://github.com/soundor/soundor/commit/a907c25e46a9aa424b8faeebf2cdff20768a14cd) Thanks [@dm-balakin](https://github.com/dm-balakin)! - JavaScript is compiled to QuickJS bytecode at build time: the runtime's own modules, and a built plugin's UI bundle. Opening an editor no longer parses JavaScript: for the benchmark example, startup went from 46 ms to 10 ms and the engine's heap after it from 4.7 MB to 3.2 MB. The bytecode keeps line numbers for stack traces but not source text, so a function's `toString()` no longer returns its code in a built plugin; `soundor dev` still runs source. Only bytecode compiled into the binary is ever read. Cross builds (or `-DSOUNDOR_PRECOMPILE_JS=OFF`) embed source as before.

- [#108](https://github.com/soundor/soundor/pull/108) [`b1a2699`](https://github.com/soundor/soundor/commit/b1a269977dccf753785bbbe123a799a4ec783e4b) Thanks [@dm-balakin](https://github.com/dm-balakin)! - **Breaking:** natively, plugin UIs run on Hermes, not QuickJS-NG: `eval()` and `new Function()` throw, private class members and `let`/`const` follow the lowered semantics below, and a call into JavaScript that runs past `juceRuntime({ timeLimit })` (5 s by default) is stopped. Runtime authors: the CLI's UI bundle context gains `ctx.ui.module` (the ES module) beside `ctx.ui.entry` (now the native CommonJS form), and the native `RuntimeStatistics` counts collections instead of allocations. The `soundor` CLI needs Node `^22.18.0 || >=24.11.0` (Babel 8).

  The JUCE runtime runs JavaScript on Hermes's interpreter instead of QuickJS-NG (no JIT; no Static Hermes). A built plugin embeds its UI bundle as Hermes bytecode, compiled at build time by the `hermesc` of the same pinned Hermes build, and links the VM without its compiler; `soundor dev` evaluates source and reloads as before. Hermes is built from source once per machine into Soundor's cache (several minutes, the first time), with hidden symbols, and its heap running out is an error instead of an abort: such a context fails from then on and is recreated on reload.

  Hermes has no ES modules, so the CLI now writes the UI bundle twice: `bundle.mjs`, the ES module the Web runtime loads (`ctx.ui.module`), and `bundle.js` (`ctx.ui.entry`), the native runtime's form: a CommonJS module function with classes, block scoping, private members, async functions and async generators lowered for Hermes by `@soundor/core`'s new `toNativeModule()` (Babel). `soundor:*` imports and application sources are unchanged.

  What changes for plugin code running natively: `eval()` and the `Function` constructors throw (a built plugin has no compiler, and `soundor dev` fails the same way), so code generated at run time needs a form made at build time; private class members are properties keyed by symbols of their own (fast, but visible to `Object.getOwnPropertySymbols()`, and unchecked: reading one on another object gives `undefined`); `let`/`const` have no temporal dead zone (reading one before its declaration gives `undefined`); on Linux, `localeCompare` and dates' `toLocaleString()` ignore the user's locale. Each context has a garbage-collector thread of Hermes's own. Built-ins Hermes lacks (FinalizationRegistry, `queueMicrotask`, Set methods, iterator helpers, `toSorted`, `Promise.withResolvers`, ArrayBuffer `transfer()`...) are provided; Atomics, SharedArrayBuffer, Float16Array, `Intl` and `Symbol.species` are not. `RuntimeStatistics` counts garbage collections (`collections`) instead of allocator calls.

  A UI script that never returns no longer freezes the host for good: `juceRuntime({ timeLimit })` (milliseconds, 5000 by default; `false`: none) bounds each call into JavaScript (a frame, an event, a timer, startup), past which the engine stops it with a `TimeoutError` JavaScript cannot catch; the error is logged and the context fails from then on, until the editor is opened again or `soundor dev` reloads. Natively, `RuntimeOptions::timeLimit` and `js::TimeLimitScope`. Native objects behind `soundor:native` handles are released on the UI thread, at the next tick after the collector finalizes their handles, never on the collector's own thread.

- [#111](https://github.com/soundor/soundor/pull/111) [`3fddefe`](https://github.com/soundor/soundor/commit/3fddefe972111f2948a684dca7d7bfc65a699a34) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add native timing animations for opacity and ordered transforms, playback controls,
  completion promises, declarative Animated.View transitions and browser Web Animations.

### Patch Changes

- [#101](https://github.com/soundor/soundor/pull/101) [`4aa15cd`](https://github.com/soundor/soundor/commit/4aa15cd697ae970dc6a85a3143a6027e4cfd7f3f) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Releasing the GPU no longer crashes on Linux with Vulkan drivers that clean up when a thread exits, such as Mesa's Venus (virtual machines). ANGLE now stops its worker threads before it destroys the Vulkan instance, not after the Vulkan loader has unloaded the driver.

- [#110](https://github.com/soundor/soundor/pull/110) [`48954d5`](https://github.com/soundor/soundor/commit/48954d5440a1b4949460c9f95c26805d9f148dd9) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Extend the headless benchmark runner with P99 and frame-time variability statistics.

- [#106](https://github.com/soundor/soundor/pull/106) [`6616121`](https://github.com/soundor/soundor/commit/6616121b2d3ee864386ffb8611632a467074b469) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Canvas 2D path commands (`moveTo`, `lineTo`, curves, `arc`, `rect`…) are gathered and sent to native code in one call before the next other call, instead of one call each: a 10,000-point waveform makes 7 native calls a frame instead of 10,007 and draws 23% faster. The most frequent 2D methods no longer make arrays, and the generated WebGL methods look their context up once and convert numbers inline (raw WebGL calls 15% faster).

- [#104](https://github.com/soundor/soundor/pull/104) [`54c950c`](https://github.com/soundor/soundor/commit/54c950c29530b65e0e60828fb668f928dae110c9) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `RuntimeHost::statistics()` says what a host did, for profiling: the time each step of `tick()` took, calls into `soundor:ui`, Canvas 2D and WebGL (timed too with `RuntimeOptions::timeNativeCalls`), the engine's allocations and heap, style changes, layout passes and invalidations. `soundor_run_ui` reports them per frame and per phase, and counts ticks that render nothing.

- [#105](https://github.com/soundor/soundor/pull/105) [`a436b85`](https://github.com/soundor/soundor/commit/a436b858e0bd5680dc6b0b820769c6aa44dffb51) Thanks [@dm-balakin](https://github.com/dm-balakin)! - UI updates cost what changed. Assigning a style it already has does not reach native code. A change that only looks different (a color, opacity) is drawn again but not laid out, text is measured again only when its font changes, and reading a style natively looks up only the properties it has. A view drawing a single shape with opacity needs no offscreen layer, and others a layer only the size of their box: 500 animated cells went from 22 ms to under 1 ms of rendering. The React renderer compares styles with what it set, not through `node.style`, and re-binds listeners or recomputes accessibility only when those props change.

- [#109](https://github.com/soundor/soundor/pull/109) [`76b3ba6`](https://github.com/soundor/soundor/commit/76b3ba62974076520d2e379e44ee7d0b7139745a) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Accept the CRLF bytecode revision marker emitted by CMake on Windows, and detach initialization errors before destroying their Hermes runtime.

## 0.6.0

### Minor Changes

- [#92](https://github.com/soundor/soundor/pull/92) [`0281661`](https://github.com/soundor/soundor/commit/028166180234549b18870a46f8006498b402b500) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Build ANGLE (OpenGL ES 3 on Metal, Direct3D 11 and Vulkan) from a pinned revision, once per machine and cached like Skia, as the foundation for GPU composition and WebGL. gn decides what to compile; Soundor compiles it with the plugin's own toolchain, hidden and statically linked, so no EGL or GLES symbol leaves a plugin. Nothing renders with it yet. `soundor doctor` names ANGLE among what git, Python 3 and ninja are needed for, and `-DSOUNDOR_ENABLE_GPU=OFF` builds without it.

- [#94](https://github.com/soundor/soundor/pull/94) [`d9df7bf`](https://github.com/soundor/soundor/commit/d9df7bf9539b1483fa9e172dd0111a77eac463d6) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Canvas nodes and a 2D context. `createCanvas()` (and `<Canvas>` in `@soundor/react`) makes a node code draws on, with `width`/`height` and `getContext('2d')` as on the Web, plus the `devicePixelRatio`, `ImageData` and canvas globals. The JUCE runtime draws with Skia on the CPU: state and compositing, transforms, paths, line styles, gradients and patterns, text, `drawImage` and `ImageData`; what it does not draw yet (shadows, filters, `Path2D`) throws instead of drawing something else. The web runtime's canvas is a real `<canvas>`.

- [#93](https://github.com/soundor/soundor/pull/93) [`24f56f5`](https://github.com/soundor/soundor/commit/24f56f530d7220ec92c3ea86912a28ad767951f2) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Composite on the GPU. The new `render::GpuCompositor` (ANGLE) uploads the UI's CPU layers as textures, only where they changed, and presents them into the editor's native view: a sublayer on macOS (Metal), a child window on Windows (Direct3D 11). The generated JUCE editor uses it when there is a hardware GPU, logs which renderer it chose, and composites on the CPU otherwise (always on Linux, and after a lost GPU). `SOUNDOR_RENDERER=cpu` forces the CPU.

- [#90](https://github.com/soundor/soundor/pull/90) [`03473ec`](https://github.com/soundor/soundor/commit/03473ecbc080bc73d45a92151970b76bbb35594f) Thanks [@dm-balakin](https://github.com/dm-balakin)! - macOS code signing. A config can name a signing identity (`signing.macos.identity`), and `SOUNDOR_MACOS_SIGNING_IDENTITY` overrides it; without either, binaries are signed ad-hoc. Runtimes receive the resolved settings as `ctx.signing`, and `soundor doctor` reports the identity and where it came from. The JUCE runtime now signs every macOS bundle as the last build step and verifies the signature, so the VST3 `moduleinfo.json` no longer invalidates it ([#63](https://github.com/soundor/soundor/issues/63)); with a real identity it adds the hardened runtime and a secure timestamp, which notarization requires. `soundor dev` always signs ad-hoc. The JUCE runtime builds with Ninja on macOS and Linux (an existing build tree from another generator is recreated) and keeps Visual Studio on Windows.

- [#91](https://github.com/soundor/soundor/pull/91) [`1223c9b`](https://github.com/soundor/soundor/commit/1223c9b8d8a049976511e701a8566000c3cb5b46) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Render frames through an explicit compositor. The native runtime now plans the
  view as layers (`RuntimeHost::frame()`), tracks which device pixels changed and
  rasterizes only those, and a backend-owned `render::Compositor` presents the
  result; the generated JUCE editor composites on the CPU into an image and
  repaints only the damaged parts. Nothing changes visually.

- [#97](https://github.com/soundor/soundor/pull/97) [`b3c6eeb`](https://github.com/soundor/soundor/commit/b3c6eeb76f7ed2a7c7d35c3b9d490845b19de87a) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Three.js's `WebGLRenderer` runs unmodified on Soundor's WebGL 2. The native tests cover it against the npm package, pinned. Nodes' styles can now be written one property at a time (`node.style.width = 120`, which is how Three's `setSize()` writes it), and lengths accept CSS pixels (`'120px'`), in both runtimes.

- [#96](https://github.com/soundor/soundor/pull/96) [`1a577d2`](https://github.com/soundor/soundor/commit/1a577d28b8f7d4f3302376b03f68587891002b36) Thanks [@dm-balakin](https://github.com/dm-balakin)! - WebGL is composited without copies. The generated JUCE editor makes one GPU device for the compositor and the runtime, so a canvas's WebGL image (a texture all the device's contexts share) is drawn by the GPU compositor directly, as a layer of its own. The UI is split into CPU layers below and above it, so a canvas animating every frame re-rasterizes and re-uploads none of the UI. Where the compositor cannot draw it (a CPU compositor, another device, a clip a layer cannot have), the image is read back, and frame statistics count those read-backs. `RuntimeHost::frame()` takes the compositor's capabilities.

- [#95](https://github.com/soundor/soundor/pull/95) [`8118dab`](https://github.com/soundor/soundor/commit/8118dabc143da1313ae1b81a12f91a5083bdc834) Thanks [@dm-balakin](https://github.com/dm-balakin)! - WebGL 2 on canvas nodes. `getContext('webgl2')` gives a `WebGL2RenderingContext` in both runtimes, typed from the Khronos IDL. The JUCE runtime runs it on the GPU through ANGLE's WebGL-compatible OpenGL ES 3.0 context, so calls are validated as in a browser. It returns null where there is no hardware GPU, and the log says why. What it draws is read back into the canvas for now. Texture uploads take arrays, `ImageData` and canvas nodes. `getContext()` now returns null for types other than `'2d'` and `'webgl2'` in both runtimes, and the web runtime's contexts take canvas and image nodes wherever they take an image.

### Patch Changes

- [#87](https://github.com/soundor/soundor/pull/87) [`77a3db1`](https://github.com/soundor/soundor/commit/77a3db1c1079402db7f9b889ae797032e0284c6d) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `Modal` with `onRequestClose` offers assistive technology's `escape` (VoiceOver's scrub), which asks the topmost modal to close as Escape does. Activating a `TextInput` through assistive technology starts editing it (keyboard focus). The README documents the accessibility architecture: the three trees, the backend matrix, framework independence and coordinates, with examples for a button, a toggle, an adjustable gain control, a text input and a modal. The `primitives` example gains an accessible knob.

- [#99](https://github.com/soundor/soundor/pull/99) [`e687cab`](https://github.com/soundor/soundor/commit/e687cab2c872ae3972a5bcde546fee43afb74676) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Faster WebGL calls and less redrawing around WebGL canvases. The generated WebGL methods call native code with no intermediate argument arrays, and uniform-location checks allocate nothing, which halves the cost of `uniform*` calls. Around a WebGL canvas, damage goes to the CPU layer it belongs to, so a change above the canvas no longer redraws the UI below it. A CPU layer that paints nothing is left out of the frame.

- [#100](https://github.com/soundor/soundor/pull/100) [`598bedc`](https://github.com/soundor/soundor/commit/598bedc9634f1ea2448bbe436f61b3b960a6fe36) Thanks [@dm-balakin](https://github.com/dm-balakin)! - WebGL survives losing the GPU. A GPU reset (or a removed GPU) loses canvases' WebGL contexts the way browsers do: calls then do nothing, `getError()` reports `CONTEXT_LOST_WEBGL`, and the canvas gets `webglcontextlost`. Meanwhile the editor goes on compositing on the CPU. `WEBGL_lose_context`'s `loseContext()` really loses the context. The plugin log says which GPU WebGL runs on.

## 0.5.0

### Minor Changes

- [#84](https://github.com/soundor/soundor/pull/84) [`9df67d1`](https://github.com/soundor/soundor/commit/9df67d1652ddcad59ec952545b2b0a18bf94cff4) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Screen readers on Windows (UI Automation) and Linux x64 (AT-SPI) now read the plugin view, through AccessKit. It presents Soundor's own semantic tree; JUCE's accessibility is not involved. The generated editor attaches it to its peer's native view and keeps its geometry and focus up to date. AccessKit's requests (click, increment, decrement, set value, focus, custom actions) reach the view as accessibility actions on the UI thread.

  AccessKit 0.23.1 comes from the official prebuilt release (pinned, SHA-256 verified, cached once per machine), so no Rust toolchain is needed. It is linked privately and none of its symbols is exported. Linux arm64 has no prebuilt library and builds without platform accessibility. The native core gains `a11y::createPlatformAccessibility()`: a framework-independent attachment that a future runtime (iPlug2) can use the same way.

- [#85](https://github.com/soundor/soundor/pull/85) [`50ccc35`](https://github.com/soundor/soundor/commit/50ccc355470f7ddc08e2d0bc9b756c6b13d7455b) Thanks [@dm-balakin](https://github.com/dm-balakin)! - VoiceOver reads the plugin view on macOS through Soundor's own bridge: virtual `NSAccessibilityElement`s built from Soundor's semantic tree, with no view per control and neither AccessKit nor JUCE's accessibility. VoiceOver's press, increment, decrement, cancel, set value and custom actions reach plugin code as accessibility actions on the UI thread. Value, title, layout, focus and destroyed-element changes are announced. Frames follow the window.

  It is safe in a plugin host. The single element class is created at runtime under a random name that carries the plugin's ABI namespace. Nothing is swizzled and no existing class is modified. Elements reach their bridge only by token. Once the class exists the binary stays loaded, so nothing VoiceOver keeps can call into unloaded code. The bridge activates only while VoiceOver or Switch Control is on.

- [#81](https://github.com/soundor/soundor/pull/81) [`4f6615b`](https://github.com/soundor/soundor/commit/4f6615bb0a027d16557721203f5efaa77b930d85) Thanks [@dm-balakin](https://github.com/dm-balakin)! - **Breaking:** `pressable()`'s and `Pressable`'s `onPress` and `onLongPress` may now receive an `AccessibilityActionEvent` (assistive technology's `activate` and `longpress`) besides pointer and keyboard events.

  Accessibility semantics owned by Soundor. Components take React Native's accessibility props (`accessible`, `accessibilityLabel`, `accessibilityHint`, `accessibilityRole` — including `dialog` — `accessibilityState`, `accessibilityValue` with fractional values, `accessibilityActions`, `onAccessibilityAction`). `Pressable` is a button by default, labelled by its text, offering `activate` and reflecting `disabled`; `Modal` is a modal dialog (`accessibilityLabel`), and overlays opened from inside an overlay belong to it.

  `soundor:ui` nodes gain `accessibility`, `accessibilityParent` and the `accessibilityaction` event (`AccessibilityActionEvent`). The JUCE runtime's native core builds a platform-neutral semantic tree from the view (`a11y::SurfaceSemantics`: stable ids, incremental updates, modal scoping, implicit labels, safe action routing) for platform adapters to present; the web runtime checks the same properties.

### Patch Changes

- [#86](https://github.com/soundor/soundor/pull/86) [`628a587`](https://github.com/soundor/soundor/commit/628a587c657f1b0931a1cb96e419768c670cf578) Thanks [@dm-balakin](https://github.com/dm-balakin)! - The native runtime gains Soundor's iOS VoiceOver bridge: virtual `UIAccessibilityElement`s from the semantic tree. Double tap, swipe up and down on adjustables (with the new value announced), the escape gesture and custom actions all reach plugin code. Containers are semantic groups, and modals post screen changes. It shares the macOS bridge's plugin-safety machinery (runtime class, tokens, pinning). Soundor has no iOS plugin build yet, so CI compiles the bridge for the simulator, and its attachment contract and device checklist are documented.

## 0.4.0

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

- [#42](https://github.com/soundor/soundor/pull/42) [`9b4473e`](https://github.com/soundor/soundor/commit/9b4473e111e72768af25e38a50e33b3641e2b9d3) Thanks [@dm-balakin](https://github.com/dm-balakin)! - **Breaking:** the plugin's identity moves to a top-level `plugin: { id, name }`, `nativeMethods` is replaced by a typed `native` API, and the JUCE WebView UI is removed.

  - `plugin.id` (reverse-DNS) and `plugin.name` are required. JUCE uses them as `BUNDLE_ID` and `PRODUCT_NAME`. `juceRuntime()` options are flattened to JUCE-only settings (`jucePath`, `formats`, `companyName`, `pluginCode`, `manufacturerCode`); the codes default to stable values derived from `plugin.id`.
  - `native: { types, methods }` declares structs, enums, opaque handles and methods, including `async` ones. `soundor gen` emits `native.d.ts` (the `soundor:native` module), and the JUCE runtime generates a C++ `soundor::native::NativeApi` interface plus validated, zero-copy QuickJS bindings for it.
  - The JUCE editor no longer hosts a `WebBrowserComponent`: there is no bridge manifest, native allowlist, embedded UI bundle or dev-server URL. `@soundor/juce-runtime/bridge` is removed. The editor is an empty plugin view until the native UI lands.

- [#48](https://github.com/soundor/soundor/pull/48) [`1a6e00b`](https://github.com/soundor/soundor/commit/1a6e00b1dca06f87af6c05854c90c0e32ad6e43f) Thanks [@dm-balakin](https://github.com/dm-balakin)! - New `soundor:ui` module: the plugin view as a tree of nodes with flexbox layout and DOM-style input events.

  - `root`, `createView()`, `createText()`: `UiNode`s are `EventTarget`s with `appendChild`/`insertBefore`/`removeChild`, a React Native–style `style` (flexbox, spacing shorthands, percentages, absolute positioning, gaps, `pointerEvents`, text properties), `layout` and `getBoundingClientRect()`.
  - Layout by Yoga v3.2.1, pinned and built privately with hidden symbols.
  - Normalized input: pointer capture, hover enter/leave, clicks, wheel, keyboard, text input and focus with Tab navigation. Delivered as `PointerEvent`, `WheelEvent`, `KeyboardEvent`, `FocusEvent` and `InputEvent`, which capture and bubble along the tree.
  - `EventTarget` events now run capture, target and bubble phases when targets form a tree; `stopPropagation()` and `composedPath()` behave as on the Web.
  - The JUCE editor sizes the view's surface and forwards mouse, wheel and keyboard input; unhandled keys and wheel input go on to the host.
  - `soundor gen` emits `ui.d.ts` with the module's types.

## 0.2.0

### Minor Changes

- [#39](https://github.com/soundor/soundor/pull/39) [`ada803d`](https://github.com/soundor/soundor/commit/ada803d35820a22e22330028d2142629a3dd3581) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Scaffold a working gain: the generated processor now applies the config's `gain` parameter (ramped) and overrides `isBusesLayoutSupported` so it works in DAWs like Reaper, not just standalone.

## 0.1.1

### Patch Changes

- [#37](https://github.com/soundor/soundor/pull/37) [`1ea0c8d`](https://github.com/soundor/soundor/commit/1ea0c8d61333253e4495bebc24be39812ebf9ba5) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Added package README files

## 0.1.0

### Minor Changes

- [#29](https://github.com/soundor/soundor/pull/29) [`f34ed1d`](https://github.com/soundor/soundor/commit/f34ed1deecec653a6d67ffe9c47c5357055d5d4b) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Initial release
