# @soundor/engine

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
