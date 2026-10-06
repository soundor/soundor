# @soundor/web-runtime

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
