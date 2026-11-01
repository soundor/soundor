# @soundor/config

## 0.15.0

### Minor Changes

- [#193](https://github.com/soundor/soundor/pull/193) [`36e2599`](https://github.com/soundor/soundor/commit/36e2599acb42049a8b129055faf150af2e72874e) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `editor.resize: 'scale'` makes a resizable editor zoom rather than lay its UI out again: the UI stays laid out at `width`×`height`, and resizing draws it larger or smaller, keeping its aspect ratio (default limits: half and twice the size). In JUCE the editor offers its aspect ratio to the host (and keeps it in the Standalone), takes whatever shape a host that ignores it gives (Ardour) with the UI letterboxed in the middle, and draws the surface at the zoom, converting pointer, wheel, pointer lock and accessibility coordinates; in the web host the handle sets the zoom, and `embed` fills the iframe at the editor's layout. `useViewSize()` keeps `width` and `height` and reports the zoom in `scale`. The default, `resize: 'layout'`, is unchanged.

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

### Patch Changes

- [#172](https://github.com/soundor/soundor/pull/172) [`57cfc9f`](https://github.com/soundor/soundor/commit/57cfc9f06bc074ae820def8797a4f44963711f79) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Update dependencies: `@fastify/static` 10, React 19.3.1, Vite 8.3.5, Vitest 5.0.5 and rolldown 1.2.15.

## 0.12.0

### Minor Changes

- [#163](https://github.com/soundor/soundor/pull/163) [`e02159e`](https://github.com/soundor/soundor/commit/e02159eb8eb68a989a4dea8f405efdca9dff7798) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Soundor Driver screenshots: the engine captures its view as it renders it, as PNG (`capture` capability, `Capture.screenshot`), and the JUCE bridge uploads it to the DevTools server as binary, which keeps it as a short-lived capture clients read with their session cookie (bounded in size, number and lifetime). `driver.screenshot()`, `locator.screenshot()` and `soundor driver screenshot <path>` save it; DevTools previews and downloads it. Locators gain `waitFor()` and `isVisible()`, and a missing debug ID lists the ones there are.

- [#162](https://github.com/soundor/soundor/pull/162) [`3fe72a1`](https://github.com/soundor/soundor/commit/3fe72a188cef8f8a1b9eb4f49d5107cf41ac4096) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Soundor Driver input: the engine dispatches synthetic pointer, wheel and keyboard input through its own hit testing, capture and event dispatch (`input` capability; `Input.dispatchPointer`, `dispatchWheel`, `dispatchKey`, `typeText`, `focus` and `UI.hitTest` in the DevTools protocol), on a pointer of its own, and releases whatever it holds when control is released, the client goes or the UI reloads. `@soundor/driver` adds `pointer`, `keyboard`, control leases and locator actions (`click`, `hover`, `drag`, `dragTo`, `scroll`, `focus`, `press`, `type`) that wait until a node is actionable; `soundor driver` adds `click`, `hover`, `focus`, `move`, `drag`, `scroll`, `key` and `type`; DevTools offers Click, Hover and Focus on the selected node. The engine decodes runtime commands itself, and `Surface::key(input, typed)` is the shared key entry of the JUCE editor and synthetic input.

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

### Patch Changes

- [#137](https://github.com/soundor/soundor/pull/137) [`ee85daa`](https://github.com/soundor/soundor/commit/ee85daa245fe5f71f2faa90eafb9b86db2f6026a) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Name the source repository and directory in every package, so npm links each package to its source and resolves its README's relative links.

## 0.8.0

### Minor Changes

- [#122](https://github.com/soundor/soundor/pull/122) [`04ff5cf`](https://github.com/soundor/soundor/commit/04ff5cf759658cfda0f0ee748f1287fd29ee9848) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add optional runtime DevTools capabilities, development connection context and validated platform-specific user settings. Discover DevTools support before development without requiring existing runtimes to change.

- [#123](https://github.com/soundor/soundor/pull/123) [`7e5e33b`](https://github.com/soundor/soundor/commit/7e5e33b8aee3b3fbd07b1edab105b6d319843c7f) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add the versioned Soundor Debug Protocol and local development session server with browser WebSockets, authenticated asynchronous native IPC, instance routing, generation validation, control leases, bounded subscriptions and lifecycle cleanup.

- [#115](https://github.com/soundor/soundor/pull/115) [`51d1f5d`](https://github.com/soundor/soundor/commit/51d1f5d012dab9e8cbc60c38fa74c2bde9e4d024) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add the Soundor Vitest plugin and simulated environment with virtual modules,
  per-test runtime isolation, deterministic service configuration, and published
  package consumer validation. Make React focus scopes read the active roots.

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
