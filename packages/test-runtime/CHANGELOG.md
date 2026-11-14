# @soundor/test-runtime

## 0.17.1

### Patch Changes

- [#298](https://github.com/soundor/soundor/pull/298) [`582aeec`](https://github.com/soundor/soundor/commit/582aeec3a8191fc664d4a426dd295557918be8ee) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Publish all packages through npm trusted publishing with GitHub Actions OIDC.
- Updated dependencies [[`582aeec`](https://github.com/soundor/soundor/commit/582aeec3a8191fc664d4a426dd295557918be8ee)]:
  - @soundor/core@0.17.1
  - @soundor/expression@0.17.1

## 0.17.0

### Minor Changes

- [#254](https://github.com/soundor/soundor/pull/254) [`0ada0c5`](https://github.com/soundor/soundor/commit/0ada0c58f97b5a60ae76299895e98b0592051624) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Box shadows: `soundor:ui`'s `Style` declares `boxShadow`, a list of `BoxShadow` (`offsetX`, `offsetY`, `blur`, `spread`, `color`, `inset`), as CSS's `box-shadow`. `@soundor/react` nodes take it in `style` and compare it by value, so re-rendering the same shadows in a new array sets no style; the test runtime keeps it.

- [#252](https://github.com/soundor/soundor/pull/252) [`3275981`](https://github.com/soundor/soundor/commit/32759813fd8c6ef0f59fa10f7d2c2dc6e2f291a3) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Double clicks: `soundor:ui` declares the `dblclick` event and `PointerEvent.detail` (which click of a series a `click` is, as the platform counts them), and `@soundor/react` nodes take `onDoubleClick` and `onDoubleClickCapture`. The test runtime counts a press as its `detail` says (1 by default) and fires `dblclick` after a second click; Testing Library adds `user.dblClick()` and `fireEvent.dblClick()`, and `user.pointer` presses take a `detail`. Soundor Driver adds `locator.dblclick()`, `pointer.dblclick()` and a `clickCount` option for `pointer.down()` and `pointer.click()` (`Input.dispatchPointer`'s `clickCount`), and `soundor driver dblclick`.

- [#289](https://github.com/soundor/soundor/pull/289) [`a54e1da`](https://github.com/soundor/soundor/commit/a54e1da16a93c0097789c8e9e974632f4b12526c) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Expose plugin version and runtime environment in soundor:host, and extend host state with processing mode, sample precision, optional track metadata, loop boundaries and timecode. Rename snapshot/subscribe to getHostState/subscribeHostState. Configure plugin.version (default 0.1.0) consistently across formats.

- [#266](https://github.com/soundor/soundor/pull/266) [`496fe62`](https://github.com/soundor/soundor/commit/496fe623abcf179945db4b2df92f873cf399bb87) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Accept synchronous functional updaters on parameter and persistent state fields. Resolve once against the latest immutable store value, validate before publishing, and reject asynchronous results. Automatically bracket changed automatable parameter writes in a host gesture when no explicit gesture is active, preserving nested gestures and keeping state gestures explicit.

  Raise the runtime API version to 4 for the compatible setter addition; older runtime API versions remain supported.

- [#281](https://github.com/soundor/soundor/pull/281) [`0354f73`](https://github.com/soundor/soundor/commit/0354f730087bbde8a2f7ad34ca7595c373c20c20) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Native channels: `native.channels` declares values the plugin's native code keeps publishing and the UI shows the latest of, each one number (`peak: { type: 'float32' }`) or a buffer of up to `maxLength` numbers (`spectrum: { type: 'buffer<float32>', maxLength: 512 }`). `soundor:native` exports them as `channels`: `get()` is the latest value received (undefined before the first, the value published last when a UI opens), and `subscribe((value, sequence) => …)` hears of each newer one, at most once a frame, `sequence` counting the publications so a gap is how many were skipped. `get` and `subscribe` work unbound, so `useSyncExternalStore(channels.peak.subscribe, channels.peak.get)` works. A method can no longer be called `channels`. In tests, `publishChannel(name, value)` from `@soundor/testing-library` publishes a value.

- [#280](https://github.com/soundor/soundor/pull/280) [`27a3303`](https://github.com/soundor/soundor/commit/27a330313c40db624ef897111a5ab37a320f3ea0) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Native events: `native.events` declares what the plugin's native code tells its UI, each event with the fields of its value (`presetLoaded: { path: 'string', preset: 'Preset?' }`, `ready: {}`), of the same types as arguments. `soundor:native` exports them as `events`: `events.presetLoaded.subscribe(({ path, preset }) => …)` returns a function that unsubscribes. Subscribers run on the UI thread after the publishing call returns, in the order published, and receive only events published after they subscribed; a UI holds at most 1024 undelivered events and drops newer ones. A method can no longer be called `events`. In tests, `emitNative(name, value)` from `@soundor/testing-library` publishes one to the UI's subscribers.

- [#258](https://github.com/soundor/soundor/pull/258) [`553d8c4`](https://github.com/soundor/soundor/commit/553d8c430aab0c1e620dbd9d9be62448d41982f6) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Parameters with Soundor's own semantics. `parameters` is a record keyed by each parameter's stable id, with the types `float32`, `int8`…`uint32`, `boolean` and `choice` (options `{ value, label }`, their values inferred without `as const`, defaults and repeated options type errors); `int64`, `uint64` and `float64` are refused, as hosts carry parameters as 32-bit floats. A parameter declares its `access` (`automatable`, `manual`, `readOnly`), its `mapping` (`linear`, `log`, `power`, `symmetricPower`, or a custom pair of expressions), a `step`, a `unit`, and `format` and `parse` written with the new `@soundor/expression` builder. Validation resolves each one into typed expressions (`ParameterSemantics`) that runtimes compile, and checks defaults, steps, custom mappings and format/parse round trips. `soundor:parameters` adds `format()`, `parse()`, `toNormalized()` and `fromNormalized()`, and refuses writes to read-only parameters. `@soundor/expression` is a typed, JSON-serializable expression language with C++ and JavaScript compilers of identical semantics; the SDK re-exports it as `@soundor/runtime-sdk/expression`. The test runtime and Testing Library run the same compiled behavior, and `testParameters.set` sets read-only parameters as the processing does.

- [#263](https://github.com/soundor/soundor/pull/263) [`14b7be0`](https://github.com/soundor/soundor/commit/14b7be04bb0262c6359ba08aac2087315f72d71f) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add typed persistent application state through `soundor:state`, reusing native type declarations and validated defaults, with field subscriptions and React `useStateValue()`.

  JUCE owns state per processor, saves parameters and state together, accepts legacy APVTS projects, and calls the protected `stateRestored()` hook on the message thread after each complete restoration. Off-thread host restorations queue to that thread. Web hydrates before application startup and automatically saves snapshots to application-namespaced IndexedDB. Runtime API 2 gates state configuration for older runtimes.

- [#289](https://github.com/soundor/soundor/pull/289) [`67ffaac`](https://github.com/soundor/soundor/commit/67ffaacba3038901877563c40af773dfc2122e7d) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add soundor:env with explicit, typed, readonly public configuration values and DEV/PROD/MODE built-ins. Embed values in the shared UI bundle, resolve the same module for web host code, and support isolated configuration in the test runtime. No process environment is exposed implicitly.

- [#288](https://github.com/soundor/soundor/pull/288) [`02d06a8`](https://github.com/soundor/soundor/commit/02d06a814f8fb77b2fd8fa78f73d0c8edc809ebd) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add boolean `soundor:ui` isVisible()/subscribeVisibility() and isFocused()/subscribeFocus() APIs so plugins can react to editor visibility and keyboard focus across runtimes. Add test runtime setters and Testing Library editor helpers. The analyzer example pauses its UI subscriptions while hidden.

- [#264](https://github.com/soundor/soundor/pull/264) [`61798d1`](https://github.com/soundor/soundor/commit/61798d199d6c5a32d1f8118fba4f67184e280a13) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add optional beginGesture() and endGesture() methods to persistent state fields in JavaScript and native JUCE code. Gestures nest per field, leave writes immediate, reset on restoration, and clean up unfinished UI interactions without host automation or History recording.

  Raise the runtime API version to 3 for the additional state field methods; older runtimes remain accepted.

- [#267](https://github.com/soundor/soundor/pull/267) [`553076d`](https://github.com/soundor/soundor/commit/553076ddfee437804ce959495d967af8bd9081d2) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add processor-owned StateHistory with opt-in discrete edits, History-enabled parameter/state gestures, synchronous buffered transactions, undo/redo, subscriptions, and useStateHistory(). JavaScript and native C++ share one manager in JUCE; Web and simulated runtimes implement the same contract. History survives editor recreation and clears on project restoration. Runtime API 5 is now required so older runtimes cannot silently ignore History options.

### Patch Changes

- Updated dependencies [[`496fe62`](https://github.com/soundor/soundor/commit/496fe623abcf179945db4b2df92f873cf399bb87), [`0354f73`](https://github.com/soundor/soundor/commit/0354f730087bbde8a2f7ad34ca7595c373c20c20), [`27a3303`](https://github.com/soundor/soundor/commit/27a330313c40db624ef897111a5ab37a320f3ea0), [`13da21d`](https://github.com/soundor/soundor/commit/13da21de509056defdaf7959cc7af78eb345ea1a), [`d5b9b16`](https://github.com/soundor/soundor/commit/d5b9b167c52bea1113785d84d62fb78e8409d06d), [`553d8c4`](https://github.com/soundor/soundor/commit/553d8c430aab0c1e620dbd9d9be62448d41982f6), [`14b7be0`](https://github.com/soundor/soundor/commit/14b7be04bb0262c6359ba08aac2087315f72d71f), [`67ffaac`](https://github.com/soundor/soundor/commit/67ffaacba3038901877563c40af773dfc2122e7d), [`258c891`](https://github.com/soundor/soundor/commit/258c8911cecc26d26e22c7bcc0d78d52dde66fc7), [`61798d1`](https://github.com/soundor/soundor/commit/61798d199d6c5a32d1f8118fba4f67184e280a13), [`553076d`](https://github.com/soundor/soundor/commit/553076ddfee437804ce959495d967af8bd9081d2)]:
  - @soundor/core@0.17.0
  - @soundor/expression@0.17.0

## 0.16.0

### Minor Changes

- [#238](https://github.com/soundor/soundor/pull/238) [`2daa8a0`](https://github.com/soundor/soundor/commit/2daa8a0a47aa8413d4e2d50fed3660e095080762) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `ResizeObserver` is a global that observes nodes, as on the Web: its callback is told after a frame's `requestAnimationFrame` callbacks and layout of each node whose content, border or device-pixel content box changed size. In the web runtime it takes the browser's place for nodes, and passes DOM elements on to it. The simulated runtime's observes nodes and never calls back, as nothing is laid out there. `useScrollbar` no longer reads sizes every frame: it is told of changes by a `ResizeObserver` and by `scroll` events. New `useCanvasSize` keeps a canvas's drawing buffer exactly the device pixels its box covers.

- [#240](https://github.com/soundor/soundor/pull/240) [`ca0158b`](https://github.com/soundor/soundor/commit/ca0158b66bafff553e878c642f3b33aff25942c9) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Any view scrolls when its style says so, an `Animated.View` too: `overflow: 'scroll'` scrolls, as in CSS, and `overflowX` and `overflowY` scroll one axis (they win over `overflow`). `ScrollView` is now a view with that style, its children in a content container, and it always scrolls; `scrollIndicators` and `onScroll` are props of every `View`. Nodes scroll smoothly with `scrollTo()`/`scrollBy()` and `behavior: 'smooth'`, and `scrollIntoView()` brings a node into view in every view around it that scrolls.

  Breaking:

  - `createScrollView()` and the `'scroll'` node type are gone: create a view with `overflow: 'scroll'`.
  - `overflow: 'scroll'` on a view scrolls it; it used to only clip, as `'hidden'` still does.
  - `scrollTo()` on a node that does not scroll does nothing, as in browsers, instead of throwing.
  - `useScrollbar(ref)` returns `{ vertical, horizontal }`, a bar for each axis, and no longer takes `axis`: `useScrollbar(ref, { axis: 'horizontal' })` is `useScrollbar(ref).horizontal`.

- [#235](https://github.com/soundor/soundor/pull/235) [`9110364`](https://github.com/soundor/soundor/commit/9110364ad76f83d4e4b9f428c7a52e72f8267837) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `useScrollbar` makes a scrollbar of your own from ordinary nodes, and `ScrollView`'s `scrollIndicators={false}` leaves out the built-in one. Nodes gain `scrollIndicators`, `clientWidth` and `clientHeight`.

### Patch Changes

- [#235](https://github.com/soundor/soundor/pull/235) [`9110364`](https://github.com/soundor/soundor/commit/9110364ad76f83d4e4b9f428c7a52e72f8267837) Thanks [@dm-balakin](https://github.com/dm-balakin)! - The simulated runtime fires `scroll` from code as the real ones do: once at the next frame, also for `scrollTop` and `scrollLeft`, and not when the position did not move.

## 0.15.0

### Minor Changes

- [#201](https://github.com/soundor/soundor/pull/201) [`54ed098`](https://github.com/soundor/soundor/commit/54ed098e0c0aeb21665057b03ff26fb95195c2cc) Thanks [@dm-balakin](https://github.com/dm-balakin)! - A resizable editor's limits are now what it asks for. By default it opens at its size and only grows, without a maximum: `minWidth`/`minHeight` default to the opening size, and `maxWidth`/`maxHeight` to `Infinity` (which a config may also write). The limits, and the aspect ratio of an editor that scales (`editor.keepAspectRatio`, default `true`), are offered to hosts that ask and kept by the Standalone and the web host's handle; a host that sets a larger window or another shape regardless (Ardour) gets it, the minimum only held. `editor.fit` decides what the UI does in such a window, for every resizable editor: `'contain'`, the default, lays it out at most at its maximum (or, scaling, at its zoom, capped by the maximum) in the middle, with bands of the editor's background; `'cover'` lays it out over the whole window, `viewSize().safeArea` (and `useViewSize()`) saying where the part it was made for is. The web host applies the same rules in `?embed`, where the page owns the size, and hides its handle where the limits allow no other size. `soundor:ui` adds `editorSize()` and `subscribeEditorSize()`, the editor's actual size in its own logical pixels, told once per change whoever resized it. `EditorConfig` is now a union that allows `fit` only with `resizable: true` and `keepAspectRatio` only with `resize: 'scale'` (validation rejects `fit: 'cover'` and `keepAspectRatio: true` elsewhere), and reports a maximum below the opening size; `ResolvedEditorConfig` always has both, and `DEFAULT_EDITOR_LIMITS` is gone. In tests, `testView.resize({ safeArea })` sets the safe area and `testEditor.resize()` the editor's size.

- [#201](https://github.com/soundor/soundor/pull/201) [`bffc8ea`](https://github.com/soundor/soundor/commit/bffc8ea6d3a1d00bc3977d3a7f1765ff926447a0) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `soundor:ui` gains `requestEditorSize(width, height)`: plugin code asks for another editor size, any finite one, held to the editor's limits (and, scaling, its aspect ratio), which the host gives or not; it returns the size asked of the host, or `null` where none can be; `editorSize().resizable` says whether it can ask (false for a fixed editor and in `?embed`). Pointer events gain `screenX`/`screenY`, the pointer on the screen in the editor's pixels, so a resize grip drawn by the UI measures its drag in units the resize does not change. The JUCE editor applies requests with `setSize()` after the UI's code ran, telling the host, and keeps later requests to a minimum or maximum the host showed by giving another size in place of one asked for (Ardour's window), so a grip does not spring back at every step; the Web host resizes its viewport as its handle does. The test runtime simulates requests (`testEditor.requests()`, `editor: { resizable, minWidth, …, aspectRatio, applyRequests }`). An editor that scales keeping its aspect ratio is given the size at its ratio nearest to the one asked for, by a request or by the Web host's handle, whatever its size is, so a corner dragged narrower and taller no longer grows and shrinks in turn. The Basic and Orbit examples draw a grip of their own.

- [#206](https://github.com/soundor/soundor/pull/206) [`2a5caa9`](https://github.com/soundor/soundor/commit/2a5caa9156a2335de3490835886d19734fd64e66) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Focus rings that show only for the keyboard, and outlines to draw them with. `node.focusVisible` (`soundor:ui`) is CSS's `:focus-visible`: focus a pointer press gave is not shown until a key is pressed (not a shortcut nor a modifier on its own), focus moved by Tab, assistive technology or code after a key is, and a text input's always is. Every runtime decides it by the same rules, the web runtime too rather than by the browser's. A `focusvisiblechange` event (React: `onFocusVisibleChange`) fires whenever it changes, `FocusEvent.focusVisible` says what it is, and `pressable()`'s state and React's `PressableState` have `focusVisible`. The new styles `outlineWidth`, `outlineColor` and `outlineOffset` draw a line around a node as CSS's `outline`: outside its border, following its corners, taking no room in layout and not hit, so a ring can appear without moving anything.

- [#194](https://github.com/soundor/soundor/pull/194) [`6a677ac`](https://github.com/soundor/soundor/commit/6a677ac5d2d56b31f2101435ff6d3b69f31108db) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add soundor:ui createSvg and the bounded, atomic SVG scene protocol v1. SVG roots are Yoga leaves with normal input and accessibility. Native scenes retain Skia geometry with shared path caching and damage tracking; Web scenes use native SVG elements. Add scene update, path parse and draw counters to native benchmark reports. This protocol requires engine 0.6.0 or later; React components follow through the existing React package.

- [#186](https://github.com/soundor/soundor/pull/186) [`96ef938`](https://github.com/soundor/soundor/commit/96ef938d7c0fc4dc745168a7083566400250a4a8) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `useViewSize()` in `@soundor/react` returns the plugin view's `{ width, height }` in logical pixels and its `scale` (device pixels per logical pixel), and re-renders when they change: the user resized the editor, a web host's embedding iframe changed size, or the view moved to a display of another density. It never re-renders for an unchanged size and does not poll. Underneath, `soundor:ui` has `subscribeViewSize(listener)`, and `viewSize()` is now the same frozen object until the size changes, so the pair works with `useSyncExternalStore`. The JUCE runtime tells subscribers once per change, on the editor's tick before the frame at the new size; the web runtime measures the view with the `ResizeObserver` that already updates hover, follows the page's pixel density and the host's scaling. In tests the view starts at the project's editor size, and `testView.resize()` changes it; the simulated `viewSize()` no longer throws.

## 0.14.0

### Minor Changes

- [#184](https://github.com/soundor/soundor/pull/184) [`2a4f506`](https://github.com/soundor/soundor/commit/2a4f506dd54207a927aeccf4dc1267b0a2ebfe2c) Thanks [@dm-balakin](https://github.com/dm-balakin)! - A `cursor` style sets the pointer's shape over a node and its children: `'auto'` (the default, the parent's: the arrow at the root, the I-beam in a text input), `'default'`, `'none'`, `'pointer'`, `'text'`, `'crosshair'`, `'move'`, and the `'ew-'`, `'ns-'`, `'nesw-'` and `'nwse-resize'` cursors. While a pointer is pressed, the pressed node's cursor shows wherever it is dragged. Both runtimes resolve it the same way; the JUCE runtime shows the platform's own cursors.

  Hover follows what changes under a pointer that does not move, as in browsers: when the tree, a layout or a scroll puts another node under a still mouse, `pointerleave` and `pointerenter` fire (and Pressable's `onHoverIn`/`onHoverOut`), and the cursor follows, in the next tick or frame.

- [#185](https://github.com/soundor/soundor/pull/185) [`be7853c`](https://github.com/soundor/soundor/commit/be7853cc5ccbc2e402abb0dc42fe2a99a121e5dd) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Pointer events have `movementX`/`movementY`: how far the pointer moved since its previous event, in logical pixels. A node can lock the pointer while it is pressed, for knobs and faders that turn past the screen's edge: `node.requestPointerLock()` (from `pointerdown`) hides the pointer, the screen's edges no longer stop it, its events stay at the position the lock began with only the movement changing, and on release (or `exitPointerLock()`) the pointer shows again where it began. `pointerLockNode()` is the node holding it. The JUCE runtime keeps the hidden pointer in the view, moving it back as it strays, and ends the lock however the press ends; the web runtime uses the browser's Pointer Lock. The implicit pointer capture now starts before the `pointerdown` listeners run, so they can lock the press. The test runtime and `user.pointer` support both.

- [#178](https://github.com/soundor/soundor/pull/178) [`ce7601d`](https://github.com/soundor/soundor/commit/ce7601d1df6706d3d8957bb84247fee5568bd530) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Bring your own fonts: `import inter from './Inter.ttf'` (or `.otf`) bundles a font file, and `registerFont('Inter', inter, { weight, style })` from `soundor:ui` makes it a face of a family, as CSS's `@font-face` does. Text whose `fontFamily` is a registered family is set in its closest registered face (bold and italic synthesized where none is), in views and canvases alike; text already shown is laid out again. In the web runtime, a `fontFamily` is now quoted in CSS (unless generic), so names such as `'Inter 18pt'` work as they do natively.

## 0.13.0

No changes in this release.

## 0.12.0

### Minor Changes

- [#160](https://github.com/soundor/soundor/pull/160) [`4974b0d`](https://github.com/soundor/soundor/commit/4974b0dfbd49c801d61488341d6fa05d4c8b3239) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Soundor Driver: `@soundor/driver` connects to a running plugin's DevTools session as a control client and inspects its native UI (targets, the node tree, node details, and lazy locators by debug ID, role or text); `soundor driver targets|tree|inspect` does the same from the command line, with `--json` output and stable exit codes. Components take a `debugId` prop (`node.debugId` in `soundor:ui`), which DevTools shows and the Driver finds nodes by.

## 0.11.0

No changes in this release.

## 0.10.1

### Patch Changes

- [#145](https://github.com/soundor/soundor/pull/145) [`1d7eb63`](https://github.com/soundor/soundor/commit/1d7eb63cc2c4288f05e34bdfe7cfc5af82ad4ccf) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Centralize guides and package references in `docs/`, with a documentation index,
  page navigation, and package README links that also work on npm. Add a project
  README and guides covering the idea, architecture, getting started, project
  lifecycle, parameters, and contributing.

## 0.10.0

No changes in this release.

## 0.9.0

### Patch Changes

- [#137](https://github.com/soundor/soundor/pull/137) [`ee85daa`](https://github.com/soundor/soundor/commit/ee85daa245fe5f71f2faa90eafb9b86db2f6026a) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Name the source repository and directory in every package, so npm links each package to its source and resolves its README's relative links.

## 0.8.0

### Minor Changes

- [#113](https://github.com/soundor/soundor/pull/113) [`9d8474e`](https://github.com/soundor/soundor/commit/9d8474ebfd40028eca8193a2bacaa248d17e3e5e) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Extract an isolated, framework independent testing runtime with semantic trees,
  input, services and deterministic animation time. Share the analytic spring solver
  with the Web runtime and preserve React tests through a temporary adapter.

  Make modal focus eligibility and pointer ownership deterministic, bound animation
  ownership without losing fills or replay, and fix native and simulated target
  capture propagation so stopPropagation preserves same-target bubble listeners.

- [#118](https://github.com/soundor/soundor/pull/118) [`fe21a26`](https://github.com/soundor/soundor/commit/fe21a265d8bb993dd07eccd78587f5bab33b1cb3) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add Soundor Testing Library with semantic queries, stateful pointer and keyboard interactions, React rendering and cleanup, async assertions, and deterministic animation time. Align simulated mouse capture and event cancellation with native behavior and keep frame batches on the 60 Hz timeline.

- [#115](https://github.com/soundor/soundor/pull/115) [`51d1f5d`](https://github.com/soundor/soundor/commit/51d1f5d012dab9e8cbc60c38fa74c2bde9e4d024) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add the Soundor Vitest plugin and simulated environment with virtual modules,
  per-test runtime isolation, deterministic service configuration, and published
  package consumer validation. Make React focus scopes read the active roots.

### Patch Changes

- [#121](https://github.com/soundor/soundor/pull/121) [`f144eee`](https://github.com/soundor/soundor/commit/f144eeebc1dc22a6c7ff9614f85e301c1f102d4d) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add automatically registered Soundor focus assertions and focused simulated parameter,
  host and native mock setup helpers. React setup helpers commit subscription updates
  with act. Deprecate the Vitest runtime escape hatch and document behavior-based
  application animation tests while preserving runtime lifecycle coverage.
