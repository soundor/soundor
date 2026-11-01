# @soundor/web-runtime

## 0.11.0

### Minor Changes

- [#193](https://github.com/soundor/soundor/pull/193) [`36e2599`](https://github.com/soundor/soundor/commit/36e2599acb42049a8b129055faf150af2e72874e) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `editor.resize: 'scale'` makes a resizable editor zoom rather than lay its UI out again: the UI stays laid out at `width`×`height`, and resizing draws it larger or smaller, keeping its aspect ratio (default limits: half and twice the size). In JUCE the editor offers its aspect ratio to the host (and keeps it in the Standalone), takes whatever shape a host that ignores it gives (Ardour) with the UI letterboxed in the middle, and draws the surface at the zoom, converting pointer, wheel, pointer lock and accessibility coordinates; in the web host the handle sets the zoom, and `embed` fills the iframe at the editor's layout. `useViewSize()` keeps `width` and `height` and reports the zoom in `scale`. The default, `resize: 'layout'`, is unchanged.

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
