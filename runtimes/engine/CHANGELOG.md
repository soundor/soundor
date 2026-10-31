# @soundor/engine

## 0.5.0

### Minor Changes

- [#184](https://github.com/soundor/soundor/pull/184) [`2a4f506`](https://github.com/soundor/soundor/commit/2a4f506dd54207a927aeccf4dc1267b0a2ebfe2c) Thanks [@dm-balakin](https://github.com/dm-balakin)! - A `cursor` style sets the pointer's shape over a node and its children: `'auto'` (the default, the parent's: the arrow at the root, the I-beam in a text input), `'default'`, `'none'`, `'pointer'`, `'text'`, `'crosshair'`, `'move'`, and the `'ew-'`, `'ns-'`, `'nesw-'` and `'nwse-resize'` cursors. While a pointer is pressed, the pressed node's cursor shows wherever it is dragged. Both runtimes resolve it the same way; the JUCE runtime shows the platform's own cursors.

  Hover follows what changes under a pointer that does not move, as in browsers: when the tree, a layout or a scroll puts another node under a still mouse, `pointerleave` and `pointerenter` fire (and Pressable's `onHoverIn`/`onHoverOut`), and the cursor follows, in the next tick or frame.

- [#185](https://github.com/soundor/soundor/pull/185) [`be7853c`](https://github.com/soundor/soundor/commit/be7853cc5ccbc2e402abb0dc42fe2a99a121e5dd) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Pointer events have `movementX`/`movementY`: how far the pointer moved since its previous event, in logical pixels. A node can lock the pointer while it is pressed, for knobs and faders that turn past the screen's edge: `node.requestPointerLock()` (from `pointerdown`) hides the pointer, the screen's edges no longer stop it, its events stay at the position the lock began with only the movement changing, and on release (or `exitPointerLock()`) the pointer shows again where it began. `pointerLockNode()` is the node holding it. The JUCE runtime keeps the hidden pointer in the view, moving it back as it strays, and ends the lock however the press ends; the web runtime uses the browser's Pointer Lock. The implicit pointer capture now starts before the `pointerdown` listeners run, so they can lock the press. The test runtime and `user.pointer` support both.

- [#178](https://github.com/soundor/soundor/pull/178) [`ce7601d`](https://github.com/soundor/soundor/commit/ce7601d1df6706d3d8957bb84247fee5568bd530) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Bring your own fonts: `import inter from './Inter.ttf'` (or `.otf`) bundles a font file, and `registerFont('Inter', inter, { weight, style })` from `soundor:ui` makes it a face of a family, as CSS's `@font-face` does. Text whose `fontFamily` is a registered family is set in its closest registered face (bold and italic synthesized where none is), in views and canvases alike; text already shown is laid out again. In the web runtime, a `fontFamily` is now quoted in CSS (unless generic), so names such as `'Inter 18pt'` work as they do natively.

## 0.4.0

### Minor Changes

- [#164](https://github.com/soundor/soundor/pull/164) [`f75bc0c`](https://github.com/soundor/soundor/commit/f75bc0ca9a76077bdb9b3e7df28cfa5d3b3dbab2) Thanks [@dm-balakin](https://github.com/dm-balakin)! - DevTools targets have no owner any more: every signed-in client (dashboard tabs, Soundor Driver, `soundor driver`) reads, highlights, picks, records and sends input at the same time, as several mice and keyboards share one computer. The engine keeps each client's synthetic pointer, held keys, highlight and picker apart, draws every client's highlight, and releases only a client's own input when it disconnects. The performance recording is shared and stops once every client that started it is gone.

  Breaking: the protocol is version 2. `Control.acquire`/`Control.release`, `LEASE_BUSY`/`LEASE_REQUIRED` and targets' `controller` are removed; runtime requests carry the sending `client`, and `resetControl` is replaced by `clientGone`. The Driver drops `acquireControl()`, `releaseControl()` and `hasControl`; the dashboard drops **Request control**; `soundor driver` exit code 6 now means the target is busy.

### Patch Changes

- [#173](https://github.com/soundor/soundor/pull/173) [`cc32cc8`](https://github.com/soundor/soundor/commit/cc32cc87207b9600fe88dc5037b302fd75fbc34b) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Build ANGLE against Skia's zlib instead of its own copy, so a plugin contains one zlib, and test that no two dependency archives define the same C symbol.

- [#174](https://github.com/soundor/soundor/pull/174) [`639ac93`](https://github.com/soundor/soundor/commit/639ac93e6d0ef80d6aa5d34dc01e3fcd2bfd190e) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Rename the symbols of the libjpeg-turbo, libpng and libwebp copies inside Skia to `soundor_*`, so plugins link against JUCE 9, which bundles the same libraries with plain C names.

## 0.3.0

### Minor Changes

- [#163](https://github.com/soundor/soundor/pull/163) [`e02159e`](https://github.com/soundor/soundor/commit/e02159eb8eb68a989a4dea8f405efdca9dff7798) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Soundor Driver screenshots: the engine captures its view as it renders it, as PNG (`capture` capability, `Capture.screenshot`), and the JUCE bridge uploads it to the DevTools server as binary, which keeps it as a short-lived capture clients read with their session cookie (bounded in size, number and lifetime). `driver.screenshot()`, `locator.screenshot()` and `soundor driver screenshot <path>` save it; DevTools previews and downloads it. Locators gain `waitFor()` and `isVisible()`, and a missing debug ID lists the ones there are.

- [#162](https://github.com/soundor/soundor/pull/162) [`3fe72a1`](https://github.com/soundor/soundor/commit/3fe72a188cef8f8a1b9eb4f49d5107cf41ac4096) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Soundor Driver input: the engine dispatches synthetic pointer, wheel and keyboard input through its own hit testing, capture and event dispatch (`input` capability; `Input.dispatchPointer`, `dispatchWheel`, `dispatchKey`, `typeText`, `focus` and `UI.hitTest` in the DevTools protocol), on a pointer of its own, and releases whatever it holds when control is released, the client goes or the UI reloads. `@soundor/driver` adds `pointer`, `keyboard`, control leases and locator actions (`click`, `hover`, `drag`, `dragTo`, `scroll`, `focus`, `press`, `type`) that wait until a node is actionable; `soundor driver` adds `click`, `hover`, `focus`, `move`, `drag`, `scroll`, `key` and `type`; DevTools offers Click, Hover and Focus on the selected node. The engine decodes runtime commands itself, and `Surface::key(input, typed)` is the shared key entry of the JUCE editor and synthetic input.

- [#160](https://github.com/soundor/soundor/pull/160) [`4974b0d`](https://github.com/soundor/soundor/commit/4974b0dfbd49c801d61488341d6fa05d4c8b3239) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Soundor Driver: `@soundor/driver` connects to a running plugin's DevTools session as a control client and inspects its native UI (targets, the node tree, node details, and lazy locators by debug ID, role or text); `soundor driver targets|tree|inspect` does the same from the command line, with `--json` output and stable exit codes. Components take a `debugId` prop (`node.debugId` in `soundor:ui`), which DevTools shows and the Driver finds nodes by.

## 0.2.2

### Patch Changes

- [#154](https://github.com/soundor/soundor/pull/154) [`e423f17`](https://github.com/soundor/soundor/commit/e423f17f789e8eb69cc3cf3c524b0c6e28cae174) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Images drawn much smaller than their pixels no longer alias: bundled images get mipmaps when decoded, and image nodes are drawn between the two nearest.

## 0.2.1

### Patch Changes

- [#145](https://github.com/soundor/soundor/pull/145) [`1d7eb63`](https://github.com/soundor/soundor/commit/1d7eb63cc2c4288f05e34bdfe7cfc5af82ad4ccf) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Centralize guides and package references in `docs/`, with a documentation index,
  page navigation, and package README links that also work on npm. Add a project
  README and guides covering the idea, architecture, getting started, project
  lifecycle, parameters, and contributing.

- [#142](https://github.com/soundor/soundor/pull/142) [`4f1dce8`](https://github.com/soundor/soundor/commit/4f1dce86003d76ea94ee50c11ec5fad05b312d87) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Plugin builds compile in parallel with Visual Studio too: `soundor dev` and `soundor build` pass `--parallel` to `cmake --build` (MSBuild otherwise builds one project at a time), and the engine's targets compile with `/MP` under the Visual Studio generator (cl.exe otherwise compiles a project's sources one at a time). Ninja builds were already parallel. The engine's `tidy` build can remember clang-tidy's passes in a directory (`SOUNDOR_CLANG_TIDY_CACHE`), so files whose source, headers and configuration are unchanged are not analyzed again.

## 0.2.0

### Minor Changes

- [#131](https://github.com/soundor/soundor/pull/131) [`99053ab`](https://github.com/soundor/soundor/commit/99053abfa9dc615ff9b81d6e2ec668e3d392288f) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Extract the backend-independent native engine into its own source package. Resolve it through normal package resolution, expose Soundor::Engine, and derive the C++ ABI from its exact version. Keep Apple class registration in a small shim compiled per plugin binary and preserve unloading protections.

  Move Hermes module lowering into the engine and preserve the core re-export, so ordinary core releases do not cascade into engine versions. Preserve exact stored JUCE float values when reading parameters, avoiding a lossy normalized round trip on platforms with fused floating-point arithmetic.

- [#136](https://github.com/soundor/soundor/pull/136) [`092442e`](https://github.com/soundor/soundor/commit/092442ee4067a2bef6dccecbf19d4f61a4b8fe22) Thanks [@dm-balakin](https://github.com/dm-balakin)! - JUCE plugins link the prebuilt engine by default: `juceRuntime({ engine: { mode: 'prebuilt' } })` downloads the Debug or Release libraries of the installed engine's prebuilt release for the platform the plugin targets into the Soundor cache, verifies their SHA-256 and reuses them offline; `{ mode: 'source' }` compiles the engine as before. Prebuilt mode never falls back to compiling: an engine without a release (a workspace or unpublished copy), an unsupported target or a failed download stops the configure, naming source mode. The published engine names its release in `artifacts/manifest.json`. `soundor doctor` reports the engine a build will use. The JUCE DevTools bridge compiles into every plugin and is active only with a DevTools engine.

- [#134](https://github.com/soundor/soundor/pull/134) [`9b710e2`](https://github.com/soundor/soundor/commit/9b710e2ec774df35c636f7429393e0c5b9de3b7f) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Build the engine as prebuilt archives and link them. `soundor_engine_stage` and the `prebuilt-debug`/`prebuilt-release` presets lay out a variant with every library it links, its headers for internal consumers, `hermesc`, license notices and `soundor-engine.json`; `SOUNDOR_ENGINE_PREBUILT_DEBUG_DIR` and `SOUNDOR_ENGINE_PREBUILT_RELEASE_DIR` import extracted archives as the same targets a source build defines, after checking them against the package and the build's target. Third-party notices that dependency builds leave out ship in `licenses/`. Release versions get the ABI namespace they name (0.1.0 is `soundor::v0_1_0`, not `v0_1_0_p`). `soundor_embed_ui()` keeps its generated files per target. Universal macOS builds compile Hermes for every architecture (it was built for the first one only).

### Patch Changes

- [#137](https://github.com/soundor/soundor/pull/137) [`ee85daa`](https://github.com/soundor/soundor/commit/ee85daa245fe5f71f2faa90eafb9b86db2f6026a) Thanks [@dm-balakin](https://github.com/dm-balakin)! - Name the source repository and directory in every package, so npm links each package to its source and resolves its README's relative links.
