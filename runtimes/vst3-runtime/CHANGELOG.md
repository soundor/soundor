# @soundor/vst3-runtime

## 0.2.1

### Patch Changes

- [#411](https://github.com/soundor/soundor/pull/411) [`a666ac6`](https://github.com/soundor/soundor/commit/a666ac66281a256200ecbc1163074ca51412e89d) Thanks [@dm-balakin](https://github.com/dm-balakin)! - An editor opened again no longer starts the GPU device's threads and the engine's own again. A process that opened and closed a plugin's editor all session (as a DAW does) grew with every open, because the memory each opening's threads had freed stayed in glibc arenas the next ones did not use: reported at about 180 MB over 60 opens of a WebGL editor on Linux.

  - The GPU device the editors share (ANGLE's display, its worker threads, and the driver's device and threads) is kept when the last editor closes, until the plugin is unloaded, and so is the device WebGL uses where the editor composites on the CPU (`SOUNDOR_RENDERER=cpu`), which was made for each runtime. It is still made when an editor first opens, never when the plugin loads. A device a GPU reset lost is not given to the next editor.
  - On Linux, the editors' accessibility (AT-SPI) work runs on one thread the plugin keeps, `soundor-a11y`, instead of one per editor, and file and storage work on one, `soundor-files`, instead of one per runtime. A runtime's teardown still waits until what it wrote is written.
  - The VST3 adapter ends them when the host unloads the plugin (`ModuleExit`, `ExitDll` or `bundleExit`), through the engine's new `platform::releaseModuleResources()`.

  Hermes's threads (its collector and time-limit monitor) still start with each editor's runtime, and Mesa's swapchain threads with each window.

- Updated dependencies [[`a666ac6`](https://github.com/soundor/soundor/commit/a666ac66281a256200ecbc1163074ca51412e89d), [`8518428`](https://github.com/soundor/soundor/commit/851842840dcb5f0c3b34f3dd1d50c6b09c495102), [`fa075ce`](https://github.com/soundor/soundor/commit/fa075ce7b067bc1e4847f94f70d59673b07026d6)]:
  - @soundor/engine@0.12.1
  - @soundor/runtime-sdk@0.21.1

## 0.2.0

### Minor Changes

- [#397](https://github.com/soundor/soundor/pull/397) [`9268fba`](https://github.com/soundor/soundor/commit/9268fbad89a8290280cdd295dcb1ba816ea1de88) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Every build now ships the third-party notices of what it contains, in a `licenses/` folder beside the plugin: the VST3 bundle's `Contents/Resources/licenses/` and the web build's `licenses/`, which the web host's panel links to. Besides the engine's and the VST3 SDK's notices, which the VST3 bundle already carried, it holds those of the npm packages in the UI bundle and on the web host page, the Rust crates the plugin links, Rust's standard library, and the project's own files that come with a license. Each component has a folder with its license files, `THIRD-PARTY-NOTICES.txt` has all of them in one file, and `licenses.json` lists them for tools. In the VST3 bundle, `licenses/soundor-engine/` is now `licenses/engine/` and `licenses/vst3sdk/` is `licenses/vst3-sdk/`.

  Soundor finds the notices from the build itself. A package file takes the license files nearest to it in its package, so a font next to its `OFL.txt` gets the OFL. Crates are the ones Cargo resolves for the build's target. A build fails when a component has no license text, naming it. The new `licenses` config option adds notices for what the build cannot see and replaces or drops the notice of a package or crate. `soundor licenses` lists what each runtime's build would ship, without building.

  Runtimes get an optional `licenses` phase, `LibraryBuildContext.notices()`, and the notices helpers in `@soundor/runtime-sdk`. The UI bundle writes `modules.json`, the files it kept after tree shaking. The engine's web artifact has `licenses`, and its WebAssembly archive carries Emscripten's and musl's notices too. The CLI's Rust SDK and the VST3 runtime's `soundor-vst3` crate ship a `LICENSE`.

  Packages whose own `dist` inlines npm packages now ship those packages' notices too. `@soundor/engine` puts them in `dist/licenses/`: its lowering (`@soundor/engine/native-module`) inlines Babel and what Babel uses. The engine's new `loweredCodeNotices()` returns the notice of Babel's helpers, which the lowering adds to the code it lowers, and the VST3 runtime ships that notice with every plugin. `@soundor/devtools-client` puts the notices of the React it inlines in `dist/licenses/` as well, and its header links to them. The VST3 host's release now refuses a platform package that lacks any of its four notices (VST3 SDK, SDL, Dear ImGui, Inter), and its README names all four.

### Patch Changes

- [#399](https://github.com/soundor/soundor/pull/399) [`3dfce54`](https://github.com/soundor/soundor/commit/3dfce5403ba27da505118f4a28e666b099253b61) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `soundor gen` no longer stamps the generated Rust SDK with the CLI's version: its manifest keeps `version = "0.0.0"`, so updating Soundor no longer rewrites a project's `lib/Cargo.lock`. Third-party notices still name the SDK at the CLI's version, from the new `ctx.lib.sdk` (its manifest and version) and `crateNotices`' `versions` option, which the VST3 runtime also uses for its own `soundor-vst3` crate.
- Updated dependencies [[`dd95f57`](https://github.com/soundor/soundor/commit/dd95f571502f6856d9711b6c7168e3839bd33381), [`9268fba`](https://github.com/soundor/soundor/commit/9268fbad89a8290280cdd295dcb1ba816ea1de88), [`3dfce54`](https://github.com/soundor/soundor/commit/3dfce5403ba27da505118f4a28e666b099253b61)]:
  - @soundor/engine@0.12.0
  - soundor@0.21.0
  - @soundor/runtime-sdk@0.21.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`8282460`](https://github.com/soundor/soundor/commit/82824608da3c6749103f91f23f23a5def5224bd2), [`e151fd8`](https://github.com/soundor/soundor/commit/e151fd8d9050c572904e212d6ee4610d976af1c4), [`2c5b9a4`](https://github.com/soundor/soundor/commit/2c5b9a45444421085bb3ef66613a0c5560e42ad5), [`2526d5f`](https://github.com/soundor/soundor/commit/2526d5fa3e3653f4ed82d9f10308cbf97dc632bc), [`9ee70c5`](https://github.com/soundor/soundor/commit/9ee70c51428c98939957f3f2c96e458a32cbc141), [`3e6ba0d`](https://github.com/soundor/soundor/commit/3e6ba0d44e6e189480719c78251d12a3e09e5cbd), [`1c2355e`](https://github.com/soundor/soundor/commit/1c2355efc2bd49c78cfe09a66fd71199f8f2e5fc), [`94a9f00`](https://github.com/soundor/soundor/commit/94a9f0099afb95fd60a4a012b084e4e960b72be8), [`453d4fe`](https://github.com/soundor/soundor/commit/453d4fe5661821ff20aebed3d6267980dba71b34), [`20ef0ae`](https://github.com/soundor/soundor/commit/20ef0ae64464b11fbf444d9dd1fc6f0b1441b13c)]:
  - @soundor/engine@0.11.0
  - soundor@0.20.0
  - @soundor/runtime-sdk@0.20.0

## 0.1.0

### Minor Changes

- [#348](https://github.com/soundor/soundor/pull/348) [`4c20c74`](https://github.com/soundor/soundor/commit/4c20c74c6726bb34013368ee45d3421d25da1c1b) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `fetch()`, DevTools and pointer lock move into the engine, for every runtime:

  - **`fetch()` goes through the system's HTTP stack** (`platform::systemHttpClient()`): `NSURLSession` on macOS and iOS, WinHTTP on Windows, and on Linux the system's libcurl, loaded when first used (`libcurl.so.4`, else `libcurl-gnutls.so.4`), never linked and never bundled, so HTTPS is as current as the system keeps it, with HTTP/3 where the system's stack has it. Where Linux has no libcurl, `fetch()` rejects, saying so.
  - **The DevTools bridge is the engine's** (`debug::Bridge`), over the same HTTP stack, so the VST3 runtime's Debug builds connect to DevTools too, and `soundor build vst3 --debug` builds one.
  - **Pointer lock is the engine's** (`input::PointerLock`): the VST3 runtime supports `requestPointerLock()`, and CSS's `cursor: none` hides its cursor.
  - **The engine has one JSON implementation** (`soundor::json`, strict, numbers kept as written), which the DevTools protocol and the VST3 adapter share.
  - The VST3 runtime's `soundor doctor` checks for libcurl.

- [#349](https://github.com/soundor/soundor/pull/349) [`13a089b`](https://github.com/soundor/soundor/commit/13a089bc715071d97990f1e2c478e3d4793513bb) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Publish `native.events` from the Rust controller through typed `ctx.events` publishers in VST3 and the browser. UI subscriptions still use `events.name.subscribe(callback)`.

  Regenerate and rebuild plugins with matching versions of the CLI and runtime for the updated controller contract.

- [#353](https://github.com/soundor/soundor/pull/353) [`5d8656d`](https://github.com/soundor/soundor/commit/5d8656de7ca6c98b3d31387c1b75160ef1d1bb23) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Open the plugin in the Soundor VST3 host automatically during `soundor dev vst3`.
  Install `@soundor/vst3-host` as a required peer dependency. The editor reloads UI
  edits in place and reopens after successful Rust rebuilds.

- [#356](https://github.com/soundor/soundor/pull/356) [`826ca2a`](https://github.com/soundor/soundor/commit/826ca2a9aade4834eac2d1e8e20405b52059e7b1) Thanks [@dm-balakin](https://github.com/dm-balakin)! - The VST3 runtime now builds plugins on macOS (Apple silicon or Intel, for macOS 12 or later) and on Windows x64, as well as on Linux. Each platform builds for itself. The editor is an NSView on macOS and a child HWND on Windows. On both, the editor and the Rust controller run on a timer of the host's UI thread. macOS bundles are signed as the last build step. Windows plugins link the static C runtime with MSVC's `link.exe`, which the build finds with `vswhere`. The package ships prebuilt adapters for all three platforms.

- [#346](https://github.com/soundor/soundor/pull/346) [`2f0dd59`](https://github.com/soundor/soundor/commit/2f0dd59c87a607cb2190427ac2b50141511eba4d) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add `@soundor/vst3-runtime`: Linux VST3 plugins without JUCE. A prebuilt,
  generic VST3 adapter (Steinberg's VST3 SDK 3.8.1) hosts the Soundor engine
  and the project's Rust processor and controller; `soundor build vst3` links
  them into a `.vst3` bundle, with no C++ compiled per plugin. The Rust SDK's
  controller now reads and edits `int8`, `uint8`, `int16`, `uint16` and
  `uint32` parameters (they failed to compile before).

### Patch Changes

- [#352](https://github.com/soundor/soundor/pull/352) [`e74a5cb`](https://github.com/soundor/soundor/commit/e74a5cb65971af3c00184d2c98e60911c7f347a6) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Use the engine's native text clipboard on Linux, Windows and Apple platforms. The direct VST3 editor now exchanges clipboard text with the Linux desktop.

- [#355](https://github.com/soundor/soundor/pull/355) [`e94e1c3`](https://github.com/soundor/soundor/commit/e94e1c3f642d5e3e5025a9075f43da561039e879) Thanks [@dm-balakin](https://github.com/dm-balakin)! - A change to persistent state now tells the host its project is modified: VST3's `setDirty`. A host's restore does not. The VST3 runtime also no longer declares its component distributable, since the component and its controller must share a process. After a restore it tells the host to read the parameters back. When the UI, the controller or History selects a factory preset, the host's program selector now follows.

- [#357](https://github.com/soundor/soundor/pull/357) [`4a8f6a1`](https://github.com/soundor/soundor/commit/4a8f6a1ecaf26e9a3c3dc54c2727dbf495eae0b2) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Remove the JUCE runtime: `@soundor/vst3-runtime` builds the same plugins as VST3s on Linux, macOS and Windows, without JUCE, CMake or C++ compiled per plugin. Replace `juceRuntime({ ... })` with `vst3Runtime()` in `soundor.config.ts` and `@soundor/juce-runtime` with `@soundor/vst3-runtime` (and its peer `@soundor/vst3-host`) in `package.json`; `soundor dev vst3` and `soundor build vst3` replace their `juce` forms, and builds go to `.soundor/dist/vst3/`. There are no AU or Standalone builds.

  `create-soundor-app` offers the VST3 and web runtimes. The engine's WebGL codegen is `pnpm --filter @soundor/engine gen:webgl`.

- [#358](https://github.com/soundor/soundor/pull/358) [`eddafd8`](https://github.com/soundor/soundor/commit/eddafd8cc98ce028ca971bf3b467f1c721194b00) Thanks [@dm-balakin](https://github.com/dm-balakin)! - The VST3 runtime's prebuilt adapters are a GitHub release of their own, like the engine's archives, instead of being in the npm package. The package carries `artifacts/manifest.json`, and a build downloads the adapter for its platform and variant once into the Soundor cache (`vst3-adapters/`), checking its SHA-256 and size. `SOUNDOR_VST3_ADAPTER_MANIFEST` names another manifest. `@soundor/engine/archives` exposes the engine's cache and archive installer for this.

- [#354](https://github.com/soundor/soundor/pull/354) [`16eeecf`](https://github.com/soundor/soundor/commit/16eeecf571da7894d172f902f83d3c718fb141d8) Thanks [@dm-balakin](https://github.com/dm-balakin)! - The editor runs on the engine's `editor::Editor`, the engine's shared editor:

  - An editor with `resize: 'layout'` and a maximum size keeps its layout at the maximum, centred (`fit: 'contain'`), or covers the view and reports the maximum as its safe area (`fit: 'cover'`), when a host makes it larger.
  - On the GPU, a resize presents at the new size at once instead of on the next frame.
  - `requestEditorSize()` is available only when the size limits allow another size.
  - Debug builds show the `SOUNDOR_SHOW_RENDERER=1` badge.

- [#350](https://github.com/soundor/soundor/pull/350) [`d42e9bd`](https://github.com/soundor/soundor/commit/d42e9bd6e4428c3853ff626777b5392946cd149e) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Expose the VST3 host name, track metadata, processing mode, loop bounds, and SMPTE timecode through `soundor:host` when the host provides them. Report sample precision as `float32`.

  Keep the in-process link alive so the editor can read the processor's audio settings and transport.

- [#357](https://github.com/soundor/soundor/pull/357) [`4a8f6a1`](https://github.com/soundor/soundor/commit/4a8f6a1ecaf26e9a3c3dc54c2727dbf495eae0b2) Thanks [@dm-balakin](https://github.com/dm-balakin)! - A new instance, and a restored project, select the first factory preset their parameters and state match, as the web runtime and the tests' simulated runtime do; before, nothing was selected until a preset was loaded, so `usePresetSelection()` and the host's program list showed none.

- [#360](https://github.com/soundor/soundor/pull/360) [`ff33bd7`](https://github.com/soundor/soundor/commit/ff33bd71b8d33ca3f8920a5f6a25f887daa63a27) Thanks [@dm-balakin](https://github.com/dm-balakin)! - The adapter builds with GCC without warnings, as source mode may build it on Linux.

- [#351](https://github.com/soundor/soundor/pull/351) [`7e64784`](https://github.com/soundor/soundor/commit/7e647849b2b552b9d111243396e4b0796149f7d0) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Report dynamic VST3 tail duration from Rust with `ctx.report_tail_seconds(seconds)` in `prepare()` or `process()`. VST3 hosts read the latest report when they query the processor. A fixed tail continues to use the configured duration.

- [#359](https://github.com/soundor/soundor/pull/359) [`ded85dd`](https://github.com/soundor/soundor/commit/ded85ddb840c59b24df299a646d08a89eaff3313) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Source mode for the VST3 runtime: `vst3Runtime({ engine: { mode: 'source' } })` builds the engine and the VST3 adapter on the machine with CMake (Ninja, or Visual Studio on Windows, and a C++20 compiler) instead of downloading their releases. Both builds go into the Soundor cache once per package version (`engine-source/`, `vst3-adapter-source/`), and `soundor doctor` checks CMake and Ninja in this mode. The package now carries the adapter's sources (`native/`). `engine({ mode: 'source' })` builds an installed package's native engine, and in the other modes an installed package still never compiles. `@soundor/engine/archives` also exports `withLock`.

  `soundor doctor` on Windows now also checks that the linker's library paths have the Windows SDK and the static C runtimes (`kernel32.lib`, `libucrt.lib`, `libcmt.lib`). Visual Studio can have the C++ tools without an SDK, so this tells you what to add in the Visual Studio Installer. A Windows build gives the same message before linking, instead of `link.exe`'s "cannot open file 'kernel32.lib'".

- Updated dependencies [[`e74a5cb`](https://github.com/soundor/soundor/commit/e74a5cb65971af3c00184d2c98e60911c7f347a6), [`01cc052`](https://github.com/soundor/soundor/commit/01cc0522b20fe89ad4a2ca398a23334c747c742a), [`4c20c74`](https://github.com/soundor/soundor/commit/4c20c74c6726bb34013368ee45d3421d25da1c1b), [`4a8f6a1`](https://github.com/soundor/soundor/commit/4a8f6a1ecaf26e9a3c3dc54c2727dbf495eae0b2), [`13a089b`](https://github.com/soundor/soundor/commit/13a089bc715071d97990f1e2c478e3d4793513bb), [`eddafd8`](https://github.com/soundor/soundor/commit/eddafd8cc98ce028ca971bf3b467f1c721194b00), [`2f0dd59`](https://github.com/soundor/soundor/commit/2f0dd59c87a607cb2190427ac2b50141511eba4d), [`7e64784`](https://github.com/soundor/soundor/commit/7e647849b2b552b9d111243396e4b0796149f7d0), [`ded85dd`](https://github.com/soundor/soundor/commit/ded85ddb840c59b24df299a646d08a89eaff3313)]:
  - @soundor/engine@0.10.0
  - soundor@0.19.0
  - @soundor/runtime-sdk@0.19.0
