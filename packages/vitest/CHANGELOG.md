# @soundor/vitest

## 0.17.0

### Minor Changes

- [#289](https://github.com/soundor/soundor/pull/289) [`a54e1da`](https://github.com/soundor/soundor/commit/a54e1da16a93c0097789c8e9e974632f4b12526c) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Expose plugin version and runtime environment in soundor:host, and extend host state with processing mode, sample precision, optional track metadata, loop boundaries and timecode. Rename snapshot/subscribe to getHostState/subscribeHostState. Configure plugin.version (default 0.1.0) consistently across formats.

- [#281](https://github.com/soundor/soundor/pull/281) [`0354f73`](https://github.com/soundor/soundor/commit/0354f730087bbde8a2f7ad34ca7595c373c20c20) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Native channels: `native.channels` declares values the plugin's native code keeps publishing and the UI shows the latest of, each one number (`peak: { type: 'float32' }`) or a buffer of up to `maxLength` numbers (`spectrum: { type: 'buffer<float32>', maxLength: 512 }`). `soundor:native` exports them as `channels`: `get()` is the latest value received (undefined before the first, the value published last when a UI opens), and `subscribe((value, sequence) => …)` hears of each newer one, at most once a frame, `sequence` counting the publications so a gap is how many were skipped. `get` and `subscribe` work unbound, so `useSyncExternalStore(channels.peak.subscribe, channels.peak.get)` works. A method can no longer be called `channels`. In tests, `publishChannel(name, value)` from `@soundor/testing-library` publishes a value.

- [#280](https://github.com/soundor/soundor/pull/280) [`27a3303`](https://github.com/soundor/soundor/commit/27a330313c40db624ef897111a5ab37a320f3ea0) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Native events: `native.events` declares what the plugin's native code tells its UI, each event with the fields of its value (`presetLoaded: { path: 'string', preset: 'Preset?' }`, `ready: {}`), of the same types as arguments. `soundor:native` exports them as `events`: `events.presetLoaded.subscribe(({ path, preset }) => …)` returns a function that unsubscribes. Subscribers run on the UI thread after the publishing call returns, in the order published, and receive only events published after they subscribed; a UI holds at most 1024 undelivered events and drops newer ones. A method can no longer be called `events`. In tests, `emitNative(name, value)` from `@soundor/testing-library` publishes one to the UI's subscribers.

- [#258](https://github.com/soundor/soundor/pull/258) [`553d8c4`](https://github.com/soundor/soundor/commit/553d8c430aab0c1e620dbd9d9be62448d41982f6) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Parameters with Soundor's own semantics. `parameters` is a record keyed by each parameter's stable id, with the types `float32`, `int8`…`uint32`, `boolean` and `choice` (options `{ value, label }`, their values inferred without `as const`, defaults and repeated options type errors); `int64`, `uint64` and `float64` are refused, as hosts carry parameters as 32-bit floats. A parameter declares its `access` (`automatable`, `manual`, `readOnly`), its `mapping` (`linear`, `log`, `power`, `symmetricPower`, or a custom pair of expressions), a `step`, a `unit`, and `format` and `parse` written with the new `@soundor/expression` builder. Validation resolves each one into typed expressions (`ParameterSemantics`) that runtimes compile, and checks defaults, steps, custom mappings and format/parse round trips. `soundor:parameters` adds `format()`, `parse()`, `toNormalized()` and `fromNormalized()`, and refuses writes to read-only parameters. `@soundor/expression` is a typed, JSON-serializable expression language with C++ and JavaScript compilers of identical semantics; the SDK re-exports it as `@soundor/runtime-sdk/expression`. The test runtime and Testing Library run the same compiled behavior, and `testParameters.set` sets read-only parameters as the processing does.

- [#263](https://github.com/soundor/soundor/pull/263) [`14b7be0`](https://github.com/soundor/soundor/commit/14b7be04bb0262c6359ba08aac2087315f72d71f) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add typed persistent application state through `soundor:state`, reusing native type declarations and validated defaults, with field subscriptions and React `useStateValue()`.

  JUCE owns state per processor, saves parameters and state together, accepts legacy APVTS projects, and calls the protected `stateRestored()` hook on the message thread after each complete restoration. Off-thread host restorations queue to that thread. Web hydrates before application startup and automatically saves snapshots to application-namespaced IndexedDB. Runtime API 2 gates state configuration for older runtimes.

- [#289](https://github.com/soundor/soundor/pull/289) [`67ffaac`](https://github.com/soundor/soundor/commit/67ffaacba3038901877563c40af773dfc2122e7d) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add soundor:env with explicit, typed, readonly public configuration values and DEV/PROD/MODE built-ins. Embed values in the shared UI bundle, resolve the same module for web host code, and support isolated configuration in the test runtime. No process environment is exposed implicitly.

- [#264](https://github.com/soundor/soundor/pull/264) [`61798d1`](https://github.com/soundor/soundor/commit/61798d199d6c5a32d1f8118fba4f67184e280a13) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add optional beginGesture() and endGesture() methods to persistent state fields in JavaScript and native JUCE code. Gestures nest per field, leave writes immediate, reset on restoration, and clean up unfinished UI interactions without host automation or History recording.

  Raise the runtime API version to 3 for the additional state field methods; older runtimes remain accepted.

- [#267](https://github.com/soundor/soundor/pull/267) [`553076d`](https://github.com/soundor/soundor/commit/553076ddfee437804ce959495d967af8bd9081d2) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add processor-owned StateHistory with opt-in discrete edits, History-enabled parameter/state gestures, synchronous buffered transactions, undo/redo, subscriptions, and useStateHistory(). JavaScript and native C++ share one manager in JUCE; Web and simulated runtimes implement the same contract. History survives editor recreation and clears on project restoration. Runtime API 5 is now required so older runtimes cannot silently ignore History options.

### Patch Changes

- Updated dependencies [[`0ada0c5`](https://github.com/soundor/soundor/commit/0ada0c58f97b5a60ae76299895e98b0592051624), [`3275981`](https://github.com/soundor/soundor/commit/32759813fd8c6ef0f59fa10f7d2c2dc6e2f291a3), [`a54e1da`](https://github.com/soundor/soundor/commit/a54e1da16a93c0097789c8e9e974632f4b12526c), [`496fe62`](https://github.com/soundor/soundor/commit/496fe623abcf179945db4b2df92f873cf399bb87), [`0354f73`](https://github.com/soundor/soundor/commit/0354f730087bbde8a2f7ad34ca7595c373c20c20), [`27a3303`](https://github.com/soundor/soundor/commit/27a330313c40db624ef897111a5ab37a320f3ea0), [`13da21d`](https://github.com/soundor/soundor/commit/13da21de509056defdaf7959cc7af78eb345ea1a), [`d5b9b16`](https://github.com/soundor/soundor/commit/d5b9b167c52bea1113785d84d62fb78e8409d06d), [`553d8c4`](https://github.com/soundor/soundor/commit/553d8c430aab0c1e620dbd9d9be62448d41982f6), [`14b7be0`](https://github.com/soundor/soundor/commit/14b7be04bb0262c6359ba08aac2087315f72d71f), [`67ffaac`](https://github.com/soundor/soundor/commit/67ffaacba3038901877563c40af773dfc2122e7d), [`02d06a8`](https://github.com/soundor/soundor/commit/02d06a814f8fb77b2fd8fa78f73d0c8edc809ebd), [`258c891`](https://github.com/soundor/soundor/commit/258c8911cecc26d26e22c7bcc0d78d52dde66fc7), [`61798d1`](https://github.com/soundor/soundor/commit/61798d199d6c5a32d1f8118fba4f67184e280a13), [`553076d`](https://github.com/soundor/soundor/commit/553076ddfee437804ce959495d967af8bd9081d2)]:
  - @soundor/test-runtime@0.17.0
  - @soundor/config@0.17.0
  - @soundor/core@0.17.0

## 0.16.0

### Minor Changes

- [#208](https://github.com/soundor/soundor/pull/208) [`01bf473`](https://github.com/soundor/soundor/commit/01bf473f0fe1d09678b8e34073d7642fbbbb95e7) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Enable the `soundor` package condition when bundling plugin UIs and running
  Soundor Vitest tests, including external dependencies. Libraries can expose
  Soundor and DOM implementations through the same import, with the Soundor
  entry selected for both JUCE and the web runtime. New projects include
  `customConditions: ["soundor"]` in their UI tsconfig; existing and manually
  created projects should add it to select matching TypeScript declarations.

### Patch Changes

- Updated dependencies [[`7fb3f13`](https://github.com/soundor/soundor/commit/7fb3f13f2e3435764e0c5c84ba0b2c44ef805430), [`2daa8a0`](https://github.com/soundor/soundor/commit/2daa8a0a47aa8413d4e2d50fed3660e095080762), [`ca0158b`](https://github.com/soundor/soundor/commit/ca0158b66bafff553e878c642f3b33aff25942c9), [`9110364`](https://github.com/soundor/soundor/commit/9110364ad76f83d4e4b9f428c7a52e72f8267837), [`9110364`](https://github.com/soundor/soundor/commit/9110364ad76f83d4e4b9f428c7a52e72f8267837)]:
  - @soundor/core@0.16.0
  - @soundor/test-runtime@0.16.0
  - @soundor/config@0.16.0

## 0.15.0

### Minor Changes

- [#201](https://github.com/soundor/soundor/pull/201) [`bffc8ea`](https://github.com/soundor/soundor/commit/bffc8ea6d3a1d00bc3977d3a7f1765ff926447a0) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `soundor:ui` gains `requestEditorSize(width, height)`: plugin code asks for another editor size, any finite one, held to the editor's limits (and, scaling, its aspect ratio), which the host gives or not; it returns the size asked of the host, or `null` where none can be; `editorSize().resizable` says whether it can ask (false for a fixed editor and in `?embed`). Pointer events gain `screenX`/`screenY`, the pointer on the screen in the editor's pixels, so a resize grip drawn by the UI measures its drag in units the resize does not change. The JUCE editor applies requests with `setSize()` after the UI's code ran, telling the host, and keeps later requests to a minimum or maximum the host showed by giving another size in place of one asked for (Ardour's window), so a grip does not spring back at every step; the Web host resizes its viewport as its handle does. The test runtime simulates requests (`testEditor.requests()`, `editor: { resizable, minWidth, …, aspectRatio, applyRequests }`). An editor that scales keeping its aspect ratio is given the size at its ratio nearest to the one asked for, by a request or by the Web host's handle, whatever its size is, so a corner dragged narrower and taller no longer grows and shrinks in turn. The Basic and Orbit examples draw a grip of their own.

- [#186](https://github.com/soundor/soundor/pull/186) [`96ef938`](https://github.com/soundor/soundor/commit/96ef938d7c0fc4dc745168a7083566400250a4a8) Thanks [@dm-balakin](https://github.com/dm-balakin)! - `useViewSize()` in `@soundor/react` returns the plugin view's `{ width, height }` in logical pixels and its `scale` (device pixels per logical pixel), and re-renders when they change: the user resized the editor, a web host's embedding iframe changed size, or the view moved to a display of another density. It never re-renders for an unchanged size and does not poll. Underneath, `soundor:ui` has `subscribeViewSize(listener)`, and `viewSize()` is now the same frozen object until the size changes, so the pair works with `useSyncExternalStore`. The JUCE runtime tells subscribers once per change, on the editor's tick before the frame at the new size; the web runtime measures the view with the `ResizeObserver` that already updates hover, follows the page's pixel density and the host's scaling. In tests the view starts at the project's editor size, and `testView.resize()` changes it; the simulated `viewSize()` no longer throws.

### Patch Changes

- Updated dependencies [[`54ed098`](https://github.com/soundor/soundor/commit/54ed098e0c0aeb21665057b03ff26fb95195c2cc), [`bffc8ea`](https://github.com/soundor/soundor/commit/bffc8ea6d3a1d00bc3977d3a7f1765ff926447a0), [`36e2599`](https://github.com/soundor/soundor/commit/36e2599acb42049a8b129055faf150af2e72874e), [`a71ac96`](https://github.com/soundor/soundor/commit/a71ac965bb43686143991a875cf162daed1cdc3b), [`2a5caa9`](https://github.com/soundor/soundor/commit/2a5caa9156a2335de3490835886d19734fd64e66), [`6a677ac`](https://github.com/soundor/soundor/commit/6a677ac5d2d56b31f2101435ff6d3b69f31108db), [`96ef938`](https://github.com/soundor/soundor/commit/96ef938d7c0fc4dc745168a7083566400250a4a8)]:
  - @soundor/config@0.15.0
  - @soundor/test-runtime@0.15.0
  - @soundor/core@0.15.0

## 0.14.0

### Minor Changes

- [#180](https://github.com/soundor/soundor/pull/180) [`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Projects no longer list `@soundor/core`. It is now a regular dependency of every package that imports it, instead of a peer dependency the project had to provide. The CLI, `@soundor/config`, `@soundor/runtime-sdk` and `@soundor/vitest` pin the exact version their release group shares, so a project still gets one copy. The runtimes take it with a caret range. New projects from `create-soundor-app` no longer include it, and an existing project can remove it from its `devDependencies`.

### Patch Changes

- Updated dependencies [[`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba), [`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba), [`2a4f506`](https://github.com/soundor/soundor/commit/2a4f506dd54207a927aeccf4dc1267b0a2ebfe2c), [`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba), [`be7853c`](https://github.com/soundor/soundor/commit/be7853cc5ccbc2e402abb0dc42fe2a99a121e5dd), [`4588cca`](https://github.com/soundor/soundor/commit/4588cca3b50a0db869c8d220408dbf23c477f1f2), [`ce7601d`](https://github.com/soundor/soundor/commit/ce7601d1df6706d3d8957bb84247fee5568bd530), [`938aa55`](https://github.com/soundor/soundor/commit/938aa559775f50ed7e493469e7da952bd43fe6ba), [`2e2080e`](https://github.com/soundor/soundor/commit/2e2080e0e9d45ba6fa77a0ff4449b6db51fe25e8)]:
  - @soundor/core@0.14.0
  - @soundor/config@0.14.0
  - @soundor/test-runtime@0.14.0

## 0.13.0

### Patch Changes

- [#172](https://github.com/soundor/soundor/pull/172) [`57cfc9f`](https://github.com/soundor/soundor/commit/57cfc9f06bc074ae820def8797a4f44963711f79) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Update dependencies: `@fastify/static` 10, React 19.3.1, Vite 8.3.5, Vitest 5.0.5 and rolldown 1.2.15.
- Updated dependencies [[`57cfc9f`](https://github.com/soundor/soundor/commit/57cfc9f06bc074ae820def8797a4f44963711f79)]:
  - @soundor/config@0.13.0
  - @soundor/core@0.13.0
  - @soundor/test-runtime@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [[`e02159e`](https://github.com/soundor/soundor/commit/e02159eb8eb68a989a4dea8f405efdca9dff7798), [`3fe72a1`](https://github.com/soundor/soundor/commit/3fe72a188cef8f8a1b9eb4f49d5107cf41ac4096), [`4974b0d`](https://github.com/soundor/soundor/commit/4974b0dfbd49c801d61488341d6fa05d4c8b3239)]:
  - @soundor/config@0.12.0
  - @soundor/core@0.12.0
  - @soundor/test-runtime@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [[`35b671b`](https://github.com/soundor/soundor/commit/35b671bfab1197431ead7d0b2c6e3f967462a86a)]:
  - @soundor/core@0.11.0
  - @soundor/config@0.11.0
  - @soundor/test-runtime@0.11.0

## 0.10.1

### Patch Changes

- [#145](https://github.com/soundor/soundor/pull/145) [`1d7eb63`](https://github.com/soundor/soundor/commit/1d7eb63cc2c4288f05e34bdfe7cfc5af82ad4ccf) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Centralize guides and package references in `docs/`, with a documentation index,
  page navigation, and package README links that also work on npm. Add a project
  README and guides covering the idea, architecture, getting started, project
  lifecycle, parameters, and contributing.
- Updated dependencies [[`1d7eb63`](https://github.com/soundor/soundor/commit/1d7eb63cc2c4288f05e34bdfe7cfc5af82ad4ccf)]:
  - @soundor/config@0.10.1
  - @soundor/core@0.10.1
  - @soundor/test-runtime@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies [[`66210eb`](https://github.com/soundor/soundor/commit/66210eb00891368cf45d3847acb73e144d75c9d6)]:
  - @soundor/config@0.10.0
  - @soundor/core@0.10.0
  - @soundor/test-runtime@0.10.0

## 0.9.0

### Patch Changes

- [#137](https://github.com/soundor/soundor/pull/137) [`ee85daa`](https://github.com/soundor/soundor/commit/ee85daa245fe5f71f2faa90eafb9b86db2f6026a) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Name the source repository and directory in every package, so npm links each package to its source and resolves its README's relative links.
- Updated dependencies [[`99053ab`](https://github.com/soundor/soundor/commit/99053abfa9dc615ff9b81d6e2ec668e3d392288f), [`ee85daa`](https://github.com/soundor/soundor/commit/ee85daa245fe5f71f2faa90eafb9b86db2f6026a)]:
  - @soundor/core@0.9.0
  - @soundor/config@0.9.0
  - @soundor/test-runtime@0.9.0

## 0.8.0

### Minor Changes

- [#121](https://github.com/soundor/soundor/pull/121) [`f144eee`](https://github.com/soundor/soundor/commit/f144eeebc1dc22a6c7ff9614f85e301c1f102d4d) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add automatically registered Soundor focus assertions and focused simulated parameter,
  host and native mock setup helpers. React setup helpers commit subscription updates
  with act. Deprecate the Vitest runtime escape hatch and document behavior-based
  application animation tests while preserving runtime lifecycle coverage.

- [#115](https://github.com/soundor/soundor/pull/115) [`51d1f5d`](https://github.com/soundor/soundor/commit/51d1f5d012dab9e8cbc60c38fa74c2bde9e4d024) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add the Soundor Vitest plugin and simulated environment with virtual modules,
  per-test runtime isolation, deterministic service configuration, and published
  package consumer validation. Make React focus scopes read the active roots.

### Patch Changes

- [#118](https://github.com/soundor/soundor/pull/118) [`fe21a26`](https://github.com/soundor/soundor/commit/fe21a265d8bb993dd07eccd78587f5bab33b1cb3) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Add Soundor Testing Library with semantic queries, stateful pointer and keyboard interactions, React rendering and cleanup, async assertions, and deterministic animation time. Align simulated mouse capture and event cancellation with native behavior and keep frame batches on the 60 Hz timeline.
- Updated dependencies [[`04ff5cf`](https://github.com/soundor/soundor/commit/04ff5cf759658cfda0f0ee748f1287fd29ee9848), [`7e5e33b`](https://github.com/soundor/soundor/commit/7e5e33b8aee3b3fbd07b1edab105b6d319843c7f), [`f144eee`](https://github.com/soundor/soundor/commit/f144eeebc1dc22a6c7ff9614f85e301c1f102d4d), [`9d8474e`](https://github.com/soundor/soundor/commit/9d8474ebfd40028eca8193a2bacaa248d17e3e5e), [`fe21a26`](https://github.com/soundor/soundor/commit/fe21a265d8bb993dd07eccd78587f5bab33b1cb3), [`51d1f5d`](https://github.com/soundor/soundor/commit/51d1f5d012dab9e8cbc60c38fa74c2bde9e4d024)]:
  - @soundor/config@0.8.0
  - @soundor/test-runtime@0.8.0
  - @soundor/core@0.8.0
