# @soundor/engine

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
