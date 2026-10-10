# @soundor/juce-runtime

## 0.6.1

### Patch Changes

- [#101](https://github.com/soundor/soundor/pull/101) [`4aa15cd`](https://github.com/soundor/soundor/commit/4aa15cd697ae970dc6a85a3143a6027e4cfd7f3f) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Releasing the GPU no longer crashes on Linux with Vulkan drivers that clean up when a thread exits, such as Mesa's Venus (virtual machines). ANGLE now stops its worker threads before it destroys the Vulkan instance, not after the Vulkan loader has unloaded the driver.

- [#106](https://github.com/soundor/soundor/pull/106) [`6616121`](https://github.com/soundor/soundor/commit/6616121b2d3ee864386ffb8611632a467074b469) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Canvas 2D path commands (`moveTo`, `lineTo`, curves, `arc`, `rect`…) are gathered and sent to native code in one call before the next other call, instead of one call each: a 10,000-point waveform makes 7 native calls a frame instead of 10,007 and draws 23% faster. The most frequent 2D methods no longer make arrays, and the generated WebGL methods look their context up once and convert numbers inline (raw WebGL calls 15% faster).

- [#104](https://github.com/soundor/soundor/pull/104) [`54c950c`](https://github.com/soundor/soundor/commit/54c950c29530b65e0e60828fb668f928dae110c9) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `RuntimeHost::statistics()` says what a host did, for profiling: the time each step of `tick()` took, calls into `soundor:ui`, Canvas 2D and WebGL (timed too with `RuntimeOptions::timeNativeCalls`), the engine's allocations and heap, style changes, layout passes and invalidations. `soundor_run_ui` reports them per frame and per phase, and counts ticks that render nothing.

- [#105](https://github.com/soundor/soundor/pull/105) [`a436b85`](https://github.com/soundor/soundor/commit/a436b858e0bd5680dc6b0b820769c6aa44dffb51) Thanks [@dm-balakin](https://github.com/dm-balakin)! - UI updates cost what changed. Assigning a style it already has does not reach native code. A change that only looks different (a color, opacity) is drawn again but not laid out, text is measured again only when its font changes, and reading a style natively looks up only the properties it has. A view drawing a single shape with opacity needs no offscreen layer, and others a layer only the size of their box: 500 animated cells went from 22 ms to under 1 ms of rendering. The React renderer compares styles with what it set, not through `node.style`, and re-binds listeners or recomputes accessibility only when those props change.

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
