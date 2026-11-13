# @soundor/runtime-sdk

## 0.17.0

### Minor Changes

- [#256](https://github.com/soundor/soundor/pull/256) [`d5b9b16`](https://github.com/soundor/soundor/commit/d5b9b167c52bea1113785d84d62fb78e8409d06d) Thanks [@dm-balakin](https://github.com/dm-balakin)! - **Breaking:** runtimes and the CLI agree on a runtime API version. `RUNTIME_API_VERSION` (now 1) in `@soundor/config` is the version of what a runtime depends on of its host (the `Runtime` interface, `LifecycleContext`, the config it receives, the error protocol), independent of the package versions. `defineRuntime()` gives a runtime the version of the `@soundor/config` it is built with (`runtime.apiVersion`; a runtime without one implements 1), and `resolveRuntime()` refuses, with exit code 4 (`INCOMPATIBLE_RUNTIME`), one outside `MIN_RUNTIME_API_VERSION` to `RUNTIME_API_VERSION`, or one older than a config setting the project uses (`CONFIG_FEATURES`), naming its path. `soundor init`, `gen`, `dev`, `build` and `doctor` resolve every runtime they run before generating or bundling anything. `packages/config/runtime-api.json` records the contract, and a test fails when it changes, for the version to be raised if runtimes could notice.

  The config schema rejects properties it does not have (`unknown property 'mapping' in @soundor/config 0.17.0`) instead of dropping them, and `parseConfig()` refuses a project whose own `@soundor/config` is of another release line than the CLI's (`ConfigError` of kind `compatibility`).

  Errors are recognized across copies of the packages: `isSoundorError(value, code?)` checks a protocol every `SoundorError` carries (the brand `Symbol.for('soundor.error.v1')`, a string `code`, `issues`), and `isConfigError()` a `ConfigError`'s. `runPhase()` passes through, and `exitCodeFor()` classifies, an error a runtime threw from its own `@soundor/core`, where `instanceof` said no: a runtime's `ConfigError` or `EnvError` was wrapped as a `RuntimeError` with exit code 5. New: `RuntimeCompatibilityError` in core; `CONFIG_VERSION`, `RUNTIME_API_VERSION`, `MIN_RUNTIME_API_VERSION`, `CONFIG_FEATURES`, `HOST_RUNTIME_API`, `checkRuntimeCompatibility()`, `runtimeApiVersion()`, `checkProjectConfigVersion()`, `projectConfigVersion()` and `sameReleaseLine()` in config.

  `@soundor/runtime-sdk` re-exports all of `@soundor/config` and `@soundor/core`, and is the one Soundor package a runtime depends on; its new `@soundor/runtime-sdk/client` entry has what a runtime's client code needs without Node (core's springs). `defineSoundorConfig()` returns a `SoundorConfig` instead of the literal type of what it is given, so a project's config type names only `@soundor/config`, not its runtimes' packages (which a `composite` project, as `create-soundor-app` makes, could not name). Parameter types for the UI come from `soundor gen`, as before. `soundor` and `@soundor/runtime-sdk` depend on `@soundor/config` instead of declaring it a peer: both run its code.

  `soundor gen`, `init` and `doctor` exit when they fail: their progress spinner kept the process running after the error was printed.

- [#258](https://github.com/soundor/soundor/pull/258) [`553d8c4`](https://github.com/soundor/soundor/commit/553d8c430aab0c1e620dbd9d9be62448d41982f6) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Parameters with Soundor's own semantics. `parameters` is a record keyed by each parameter's stable id, with the types `float32`, `int8`…`uint32`, `boolean` and `choice` (options `{ value, label }`, their values inferred without `as const`, defaults and repeated options type errors); `int64`, `uint64` and `float64` are refused, as hosts carry parameters as 32-bit floats. A parameter declares its `access` (`automatable`, `manual`, `readOnly`), its `mapping` (`linear`, `log`, `power`, `symmetricPower`, or a custom pair of expressions), a `step`, a `unit`, and `format` and `parse` written with the new `@soundor/expression` builder. Validation resolves each one into typed expressions (`ParameterSemantics`) that runtimes compile, and checks defaults, steps, custom mappings and format/parse round trips. `soundor:parameters` adds `format()`, `parse()`, `toNormalized()` and `fromNormalized()`, and refuses writes to read-only parameters. `@soundor/expression` is a typed, JSON-serializable expression language with C++ and JavaScript compilers of identical semantics; the SDK re-exports it as `@soundor/runtime-sdk/expression`. The test runtime and Testing Library run the same compiled behavior, and `testParameters.set` sets read-only parameters as the processing does.

- [#263](https://github.com/soundor/soundor/pull/263) [`14b7be0`](https://github.com/soundor/soundor/commit/14b7be04bb0262c6359ba08aac2087315f72d71f) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add typed persistent application state through `soundor:state`, reusing native type declarations and validated defaults, with field subscriptions and React `useStateValue()`.

  JUCE owns state per processor, saves parameters and state together, accepts legacy APVTS projects, and calls the protected `stateRestored()` hook on the message thread after each complete restoration. Off-thread host restorations queue to that thread. Web hydrates before application startup and automatically saves snapshots to application-namespaced IndexedDB. Runtime API 2 gates state configuration for older runtimes.

- [#275](https://github.com/soundor/soundor/pull/275) [`258c891`](https://github.com/soundor/soundor/commit/258c8911cecc26d26e22c7bcc0d78d52dde66fc7) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Runtime packages now declare supported Soundor CLI versions through a required `soundor` peer dependency. Both first-party runtimes use a caret range matching their regular `@soundor/runtime-sdk` dependency; the SDK and CLI share the fixed package version. Before 1.0, this supports the current minor and its patches. Runtime providers own the supported range, and package managers handle peer mismatches without an additional CLI compatibility check.

  Remove the numeric `Runtime.apiVersion` and `ResolvedRuntime.apiVersion`, runtime API version constants and contract record, config-feature version gates, compatibility helpers, and `RuntimeCompatibilityError` with its dedicated error codes. Third-party runtimes should remove those imports and fields, keep the SDK as a regular dependency, and declare the supported CLI range in `peerDependencies.soundor`. The existing project config release-line check and cross-copy error protocol remain.

### Patch Changes

- Updated dependencies [[`a54e1da`](https://github.com/soundor/soundor/commit/a54e1da16a93c0097789c8e9e974632f4b12526c), [`496fe62`](https://github.com/soundor/soundor/commit/496fe623abcf179945db4b2df92f873cf399bb87), [`0354f73`](https://github.com/soundor/soundor/commit/0354f730087bbde8a2f7ad34ca7595c373c20c20), [`27a3303`](https://github.com/soundor/soundor/commit/27a330313c40db624ef897111a5ab37a320f3ea0), [`13da21d`](https://github.com/soundor/soundor/commit/13da21de509056defdaf7959cc7af78eb345ea1a), [`d5b9b16`](https://github.com/soundor/soundor/commit/d5b9b167c52bea1113785d84d62fb78e8409d06d), [`553d8c4`](https://github.com/soundor/soundor/commit/553d8c430aab0c1e620dbd9d9be62448d41982f6), [`14b7be0`](https://github.com/soundor/soundor/commit/14b7be04bb0262c6359ba08aac2087315f72d71f), [`67ffaac`](https://github.com/soundor/soundor/commit/67ffaacba3038901877563c40af773dfc2122e7d), [`258c891`](https://github.com/soundor/soundor/commit/258c8911cecc26d26e22c7bcc0d78d52dde66fc7), [`61798d1`](https://github.com/soundor/soundor/commit/61798d199d6c5a32d1f8118fba4f67184e280a13), [`553076d`](https://github.com/soundor/soundor/commit/553076ddfee437804ce959495d967af8bd9081d2)]:
  - @soundor/config@0.17.0
  - @soundor/core@0.17.0
  - @soundor/expression@0.17.0

## 0.16.0

### Patch Changes

- Updated dependencies [[`7fb3f13`](https://github.com/soundor/soundor/commit/7fb3f13f2e3435764e0c5c84ba0b2c44ef805430)]:
  - @soundor/core@0.16.0

## 0.15.0

### Minor Changes

- [#186](https://github.com/soundor/soundor/pull/186) [`a71ac96`](https://github.com/soundor/soundor/commit/a71ac965bb43686143991a875cf162daed1cdc3b) Thanks [@dm-balakin](https://github.com/dm-balakin)! - A config's `editor` sets the plugin editor's size, the same in every runtime: `width` and `height` (800×600 by default), and with `resizable: true` limits the user can resize it within (`minWidth`, `minHeight`, `maxWidth`, `maxHeight`; 480×320 to 1600×1200 by default). Without it, an editor is a fixed 800×600 view as before. `resolveEditor()` gives a runtime every field decided. The JUCE runtime's generated editor opens at that size and, when resizable, lets the host resize it within its limits; the UI is laid out again at the new size, and under the GPU compositor presented at it at once.

### Patch Changes

- Updated dependencies []:
  - @soundor/core@0.15.0

## 0.14.0

### Minor Changes

- [#180](https://github.com/soundor/soundor/pull/180) [`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Projects no longer list `@soundor/core`. It is now a regular dependency of every package that imports it, instead of a peer dependency the project had to provide. The CLI, `@soundor/config`, `@soundor/runtime-sdk` and `@soundor/vitest` pin the exact version their release group shares, so a project still gets one copy. The runtimes take it with a caret range. New projects from `create-soundor-app` no longer include it, and an existing project can remove it from its `devDependencies`.

- [#180](https://github.com/soundor/soundor/pull/180) [`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba) Thanks [@dm-balakin](https://github.com/dm-balakin)! - The runtime that runs another form of the UI now makes that form itself. The CLI bundles the UI into one ES module, `bundle.mjs`. The JUCE runtime lowers it for Hermes with the `toNativeModule()` of the engine it links (`@soundor/engine/native-module`), into `.soundor/cache/juce/ui-debug` or `ui-release`. The lowering therefore always matches the plugin's engine, and a web-only project no longer pays for it.

  `ctx.ui.entry` is removed. In `soundor dev`, `ctx.ui.live` gains `onBuild(listener)` and `sourceMap(file, mapFile)`, so that a runtime can remake its form after every build and have its stack frames mapped. `@soundor/core` no longer depends on `@soundor/engine` and no longer exports `toNativeModule()`; import it from `@soundor/engine/native-module`.

### Patch Changes

- Updated dependencies [[`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba), [`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba), [`4588cca`](https://github.com/soundor/soundor/commit/4588cca3b50a0db869c8d220408dbf23c477f1f2), [`ce7601d`](https://github.com/soundor/soundor/commit/ce7601d1df6706d3d8957bb84247fee5568bd530), [`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba), [`2e2080e`](https://github.com/soundor/soundor/commit/2e2080e0e9d45ba6fa77a0ff4449b6db51fe25e8)]:
  - @soundor/core@0.14.0

## 0.13.0

No changes in this release.

## 0.12.0

No changes in this release.

## 0.11.0

No changes in this release.

## 0.10.1

### Patch Changes

- [#145](https://github.com/soundor/soundor/pull/145) [`1d7eb63`](https://github.com/soundor/soundor/commit/1d7eb63cc2c4288f05e34bdfe7cfc5af82ad4ccf) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Centralize guides and package references in `docs/`, with a documentation index,
  page navigation, and package README links that also work on npm. Add a project
  README and guides covering the idea, architecture, getting started, project
  lifecycle, parameters, and contributing.

## 0.10.0

### Minor Changes

- [#138](https://github.com/soundor/soundor/pull/138) [`66210eb`](https://github.com/soundor/soundor/commit/66210eb00891368cf45d3847acb73e144d75c9d6) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `soundor dev` prints a summary when the runtime is ready (plugin, DevTools URL, and what the runtime adds), collapses the native build output into one progress line in a terminal (all of it is kept in `.soundor/dev/build.log`), and takes shortcuts: `o` opens DevTools signed in, `c` copies a signed-in link, `u` shows the summary again, `q` quits. Runtimes report readiness and add shortcuts through the new `ctx.session`; the JUCE runtime adds `s` to relaunch the Standalone, the Web runtime `w` to open the Web host.

## 0.9.0

### Minor Changes

- [#131](https://github.com/soundor/soundor/pull/131) [`99053ab`](https://github.com/soundor/soundor/commit/99053abfa9dc615ff9b81d6e2ec668e3d392288f) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Extract the backend-independent native engine into its own source package. Resolve it through normal package resolution, expose Soundor::Engine, and derive the C++ ABI from its exact version. Keep Apple class registration in a small shim compiled per plugin binary and preserve unloading protections.

  Move Hermes module lowering into the engine and preserve the core re-export, so ordinary core releases do not cascade into engine versions. Preserve exact stored JUCE float values when reading parameters, avoiding a lossy normalized round trip on platforms with fused floating-point arithmetic.

### Patch Changes

- [#137](https://github.com/soundor/soundor/pull/137) [`ee85daa`](https://github.com/soundor/soundor/commit/ee85daa245fe5f71f2faa90eafb9b86db2f6026a) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Name the source repository and directory in every package, so npm links each package to its source and resolves its README's relative links.

## 0.8.0

### Minor Changes

- [#122](https://github.com/soundor/soundor/pull/122) [`04ff5cf`](https://github.com/soundor/soundor/commit/04ff5cf759658cfda0f0ee748f1287fd29ee9848) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add optional runtime DevTools capabilities, development connection context and validated platform-specific user settings. Discover DevTools support before development without requiring existing runtimes to change.

## 0.7.0

No changes in this release.

## 0.6.0

No changes in this release.

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

### Patch Changes

- [#37](https://github.com/soundor/soundor/pull/37) [`1ea0c8d`](https://github.com/soundor/soundor/commit/1ea0c8d61333253e4495bebc24be39812ebf9ba5) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Added package README files

## 0.1.0

### Minor Changes

- [#29](https://github.com/soundor/soundor/pull/29) [`f34ed1d`](https://github.com/soundor/soundor/commit/f34ed1deecec653a6d67ffe9c47c5357055d5d4b) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Initial release
