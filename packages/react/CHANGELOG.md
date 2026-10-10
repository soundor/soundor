# @soundor/react

## 0.6.1

### Patch Changes

- [#105](https://github.com/soundor/soundor/pull/105) [`a436b85`](https://github.com/soundor/soundor/commit/a436b858e0bd5680dc6b0b820769c6aa44dffb51) Thanks [@dm-balakin](https://github.com/dm-balakin)! - UI updates cost what changed. Assigning a style it already has does not reach native code. A change that only looks different (a color, opacity) is drawn again but not laid out, text is measured again only when its font changes, and reading a style natively looks up only the properties it has. A view drawing a single shape with opacity needs no offscreen layer, and others a layer only the size of their box: 500 animated cells went from 22 ms to under 1 ms of rendering. The React renderer compares styles with what it set, not through `node.style`, and re-binds listeners or recomputes accessibility only when those props change.

## 0.6.0

### Minor Changes

- [#87](https://github.com/soundor/soundor/pull/87) [`77a3db1`](https://github.com/soundor/soundor/commit/77a3db1c1079402db7f9b889ae797032e0284c6d) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `Modal` with `onRequestClose` offers assistive technology's `escape` (VoiceOver's scrub), which asks the topmost modal to close as Escape does. Activating a `TextInput` through assistive technology starts editing it (keyboard focus). The README documents the accessibility architecture: the three trees, the backend matrix, framework independence and coordinates, with examples for a button, a toggle, an adjustable gain control, a text input and a modal. The `primitives` example gains an accessible knob.

- [#94](https://github.com/soundor/soundor/pull/94) [`d9df7bf`](https://github.com/soundor/soundor/commit/d9df7bf9539b1483fa9e172dd0111a77eac463d6) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Canvas nodes and a 2D context. `createCanvas()` (and `<Canvas>` in `@soundor/react`) makes a node code draws on, with `width`/`height` and `getContext('2d')` as on the Web, plus the `devicePixelRatio`, `ImageData` and canvas globals. The JUCE runtime draws with Skia on the CPU: state and compositing, transforms, paths, line styles, gradients and patterns, text, `drawImage` and `ImageData`; what it does not draw yet (shadows, filters, `Path2D`) throws instead of drawing something else. The web runtime's canvas is a real `<canvas>`.

- [#95](https://github.com/soundor/soundor/pull/95) [`8118dab`](https://github.com/soundor/soundor/commit/8118dabc143da1313ae1b81a12f91a5083bdc834) Thanks [@dm-balakin](https://github.com/dm-balakin)! - WebGL 2 on canvas nodes. `getContext('webgl2')` gives a `WebGL2RenderingContext` in both runtimes, typed from the Khronos IDL. The JUCE runtime runs it on the GPU through ANGLE's WebGL-compatible OpenGL ES 3.0 context, so calls are validated as in a browser. It returns null where there is no hardware GPU, and the log says why. What it draws is read back into the canvas for now. Texture uploads take arrays, `ImageData` and canvas nodes. `getContext()` now returns null for types other than `'2d'` and `'webgl2'` in both runtimes, and the web runtime's contexts take canvas and image nodes wherever they take an image.

## 0.5.0

### Minor Changes

- [#81](https://github.com/soundor/soundor/pull/81) [`4f6615b`](https://github.com/soundor/soundor/commit/4f6615bb0a027d16557721203f5efaa77b930d85) Thanks [@dm-balakin](https://github.com/dm-balakin)! - **Breaking:** `pressable()`'s and `Pressable`'s `onPress` and `onLongPress` may now receive an `AccessibilityActionEvent` (assistive technology's `activate` and `longpress`) besides pointer and keyboard events.

  Accessibility semantics owned by Soundor. Components take React Native's accessibility props (`accessible`, `accessibilityLabel`, `accessibilityHint`, `accessibilityRole` — including `dialog` — `accessibilityState`, `accessibilityValue` with fractional values, `accessibilityActions`, `onAccessibilityAction`). `Pressable` is a button by default, labelled by its text, offering `activate` and reflecting `disabled`; `Modal` is a modal dialog (`accessibilityLabel`), and overlays opened from inside an overlay belong to it.

  `soundor:ui` nodes gain `accessibility`, `accessibilityParent` and the `accessibilityaction` event (`AccessibilityActionEvent`). The JUCE runtime's native core builds a platform-neutral semantic tree from the view (`a11y::SurfaceSemantics`: stable ids, incremental updates, modal scoping, implicit labels, safe action routing) for platform adapters to present; the web runtime checks the same properties.

## 0.4.0

### Minor Changes

- [#74](https://github.com/soundor/soundor/pull/74) [`fce95b6`](https://github.com/soundor/soundor/commit/fce95b60716eda4ff949f52d667b56e412d8e8ae) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `FocusScope`: a boundary for keyboard focus that adds no node, so layout is unchanged.

  - `trapped`: Tab and Shift+Tab cycle through the scope's focusable nodes (wrapping, skipping hidden and unfocusable ones) instead of the whole view, and focus moved outside, programmatically or by a press, is taken back. The innermost trapping scope wins.
  - `autoFocus`: on mount, focuses the first focusable node unless focus is already inside.
  - `restoreFocus`: on unmount, returns focus to the node that had it on mount when it is still connected and focusable; nested scopes each restore to where they were opened.
  - Membership follows React's tree rather than the node tree, so content a scope renders elsewhere in the view still belongs to it.

- [#75](https://github.com/soundor/soundor/pull/75) [`97db55f`](https://github.com/soundor/soundor/commit/97db55f43711e75a2e9886775aacf998c9f5b172) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Portals, and an overlay layer to render them in, inside the plugin's one view.

  - `soundor:ui` adds `overlayRoot`: a second root that fills the view, laid out apart from `root`, drawn over all of root's content whatever its `zIndex`, and hit first, letting the pointer through where nothing in it takes it. Its events bubble up to it, not to `root`. Tab moves through the content, then the overlay. The JUCE runtime draws both trees on its one Skia surface; the Web runtime keeps both in the plugin viewport, in one isolated stacking context.
  - `@soundor/react` adds `Portal`, `Portal.Host` and `createPortalHost()`, built on the reconciler's portals: React context, state and effects survive. `<Portal>` renders into an overlay entry; entries stack in the order they open, so an overlay opened from another stacks above it. `<Portal host={host}>` renders exactly where `<Portal.Host host={host}>` is, inheriting its clipping and stacking; it renders nothing until the host mounts, follows it away and back, and showing one host in two places is an error.
  - `FocusScope` covers both trees, so portaled content that a scope renders belongs to it.

- [#76](https://github.com/soundor/soundor/pull/76) [`b7ff2ce`](https://github.com/soundor/soundor/commit/b7ff2ce383e1f15087199437511c1cf03636d4bd) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `Modal`: an in-view modal layer, built on `Portal` and `FocusScope`. It is not a window: it is drawn in the plugin's one view.

  - A `Portal` entry with a backdrop over the whole view that blocks the pointer from everything below (transparent by default; `backdropStyle` styles it), and the children above it.
  - A trapped, autofocusing, focus-restoring `FocusScope`: focus goes to the first focusable child on open, Tab stays inside, focus returns on close. With nothing focusable inside, background focus is dropped so keys cannot reach it.
  - Escape, and with `dismissOnBackdropPress` a press on the backdrop itself, call `onRequestClose`; `visible` (default `true`) keeps control with the caller. Escape goes to the topmost modal.
  - Modals stack like portals: one opened from another is above it and owns focus, and portals opened from a modal show above it inside its focus trap.

  Also: a trapping `FocusScope` drops focus that is outside it when it starts, and `Pressable` callbacks update React at the same priority as event props, so a press renders before the next task.

- [#72](https://github.com/soundor/soundor/pull/72) [`64bdb5d`](https://github.com/soundor/soundor/commit/64bdb5d1b67ecc64e6c85d6f88c01ed44cf6c335) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `soundor:ui` gets the coordinates, stacking and interaction that overlays and custom controls build on, the same in the JUCE and Web runtimes.

  - Pointer events add `pageX`/`pageY` (relative to the plugin view) and `locationX`/`locationY` (relative to the target), in logical pixels at any device or viewport scale. `clientX`/`clientY` and `offsetX`/`offsetY` stay, with the same values.
  - `style.zIndex`: an integer that stacks a node among its siblings for drawing and hit testing alike (equal values keep tree order, the later sibling on top). Every node stacks its own children; layout is not affected.
  - A `contextmenu` pointer event, which captures and bubbles, when the secondary button goes down. In the browser it bridges the DOM's `contextmenu`; preventing it keeps the browser's own menu away. `@soundor/react` adds `onContextMenu` and `onContextMenuCapture`.
  - `pressable()` and `Pressable` add `onLongPress` (the primary button held `delayLongPress` ms, 500 by default, without moving more than 10 px; no `onPress` follows it), and their state adds `focused`, from focus and blur.

## 0.3.0

### Minor Changes

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
