# AGENTS.md

This file provides guidance to coding agents (Claude Code, claude.ai/code and others) when working with code in this repository.

## What Soundor is

A toolchain for audio plugins whose UI is written once in TypeScript/React and
run by several **runtimes**. A project declares its plugin in
`soundor.config.ts` (identity, parameters, a typed `native` API, the runtimes);
the `soundor` CLI bundles `src/main.tsx` and drives each runtime through the
same lifecycle phases. Two runtimes exist:

- `@soundor/juce-runtime` (the reference): a JUCE plugin (VST3/AU/Standalone)
  hosting an embedded Hermes runtime (interpreted, bytecode compiled at build
  time) that runs the UI bundle, laid out with
  Yoga and drawn with Skia on the CPU into layers. Soundor's own compositor
  puts the layers together on the GPU (ANGLE: Metal, Direct3D 11) where it
  can, and on the CPU otherwise (Linux, fallback). Canvas nodes have a 2D
  context (Skia) and a WebGL 2 context (ANGLE), which the GPU compositor
  shows without copies; Three.js runs on it unmodified.
- `@soundor/web-runtime`: the same plugin in a browser, with the DOM and Web
  Audio. Nothing native runs there (no WASM, Hermes, Yoga or Skia).

The packages' READMEs are the authoritative spec of behavior (especially
`runtimes/juce-runtime/README.md`, `runtimes/engine/README.md`,
`runtimes/web-runtime/README.md`, `packages/react/README.md`). Keep them in
sync when behavior changes.

## Commands

pnpm 12 + Node 24 monorepo driven by Turborepo. The root scripts exclude
`examples/*`.

```sh
pnpm install
pnpm build            # tsc -b && tsdown in every package
pnpm test             # vitest in every package + native tests (cmake --workflow --preset dev)
pnpm lint             # oxlint + clang-tidy (cmake --workflow --preset tidy)
pnpm format           # oxfmt --check + clang-format check of native/
pnpm format:fix       # oxfmt . + clang-format --fix
pnpm lint:fix
pnpm check            # format + lint + build + test — what CI's Verify job runs
pnpm changeset        # add a changeset for a published package change
```

A single package or test:

```sh
pnpm --filter @soundor/react test                     # one package
pnpm --filter @soundor/react-tests exec vitest run src/modal.test.tsx -t "<test name>"
pnpm --filter soundor test                            # the CLI package is named `soundor`
```

`test` depends on `^build` in turbo, so filtered vitest runs need the
dependencies built first (`pnpm build` or `pnpm turbo run build --filter=<pkg>...`).

Native runtime (`runtimes/engine`, from that directory):

```sh
cmake --workflow --preset dev        # Debug, -Werror, doctest suites  → build/dev
cmake --workflow --preset sanitize   # ASan/UBSan/LSan                 → build/sanitize
cmake --workflow --preset tidy       # clang-tidy, build only          → build/tidy
cmake --workflow --preset nogpu      # without ANGLE (as on iOS)        → build/nogpu
cmake --workflow --preset bench      # Release soundor_run_ui (benchmarks) → build/bench
cmake --workflow --preset prebuilt-debug    # stage a prebuilt engine (also -release; needs
                                            # SOUNDOR_ENGINE_SOURCE_COMMIT) → build/prebuilt-*/stage
SOUNDOR_ENGINE_PREBUILT_DIR=<extracted> cmake --workflow --preset prebuilt-check-debug  # tests against one
(cd ../juce-runtime/native && cmake --workflow --preset juce) # JUCE adapter tests
ctest --test-dir build/dev -R <name> # one native test after a dev build
pnpm --filter @soundor/juce-runtime test:plugin  # build the JUCE test plugin (source engine)
```

The first native configure builds Skia, ANGLE and Hermes from source
(minutes) and caches them in the user cache dir (`SOUNDOR_CACHE` overrides);
later configures reuse them. `-DSOUNDOR_ENABLE_GPU=OFF` skips ANGLE. Native
builds need Node and `pnpm install`: the runtime's JavaScript modules (and the
tests' Three.js) are lowered with the engine's module-lowering source while building.

Examples (`examples/basic`, `examples/primitives`) are real projects using
the workspace packages: `pnpm --filter <example> exec soundor dev web|juce`,
`... soundor build web|juce`. They are examples only: no test or native CI job
builds them. Tests have their own fixtures, inside the package they test:
`runtimes/juce-runtime/tests/plugin` (and `plugin-prebuilt`, the same plugin
with a prebuilt engine, which `engine-prebuilts.yml` builds).

Native CI jobs each test one package and run when `turbo query affected`
reports it (`.github/scripts/native-changes.mjs`): Native ← `@soundor/engine`,
Native JUCE integration ← `@soundor/juce-runtime`, Benchmark smoke ←
`soundor-benchmark`. What a job builds must therefore be a dependency of its
package.

Benchmarks (`tools/benchmark`: rendering scenarios for WebGL, Canvas 2D and
UI updates in the JUCE runtime, headless; see `tools/benchmark/README.md`). Measure an optimization against a saved
build run alternately in the same session, not against an old report:
machines drift by several percent between sessions. The "work per frame"
counts (native calls, style changes, layouts, uploads) do not depend on
timing: a change in them is real.

```sh
pnpm --filter soundor-benchmark bench --save main      # on main
pnpm --filter soundor-benchmark bench --against main   # on the branch: what changed, beyond noise
pnpm --filter soundor-benchmark bench --only ui,canvas # some groups or scenarios
```

Regenerating checked-in generated files:

- `UPDATE_GOLDEN=1 pnpm --filter @soundor/juce-runtime test` — the golden
  `soundor:native` C++ output in `native/tests/generated`, compiled by the
  native tests.
- `pnpm --filter @soundor/core build && pnpm --filter @soundor/core gen:runtime-types`
  — `packages/core/runtime/*.d.ts`, the `soundor:*` declarations `@soundor/react`
  compiles against.

Turborepo here may be newer than what you know: before changing `turbo.json`,
read the docs bundled with the installed package
(`node -p "require.resolve('turbo/package.json')"`, then its `docs/`).

## Architecture

### Packages

- `packages/config` — `defineSoundorConfig`, the zod schema, `parseConfig`
  (reports every problem with its path), config loading (bundled with rolldown).
  Also defines the `Runtime` interface types.
- `packages/runtime-sdk` — `defineRuntime()`, which turns a runtime definition
  (`init`, `gen`, `dev`, `build`, `doctor`) into the factory a config calls
  (`juceRuntime({...})`).
- `packages/core` — shared toolchain code: codegen of `.soundor/generated`
  (the `.d.ts` for `soundor:*`, parameters, native API, Web globals), paths,
  logger, errors, command running, and the `toNativeModule()` re-export (implemented by Engine: an ES module
  into the native runtime's module form).
- `packages/cli` (`soundor`) — `init`, `gen`, `dev`, `build`, `doctor`. Loads
  the config, bundles the UI with tsdown (`src/ui/bundle.ts`: npm deps inlined,
  `soundor:*` left as imports) into `bundle.mjs` (an ES module, for the Web)
  and `bundle.js` (the native runtime's module form, lowered for Hermes), then
  calls each runtime's phase. `dev` tails
  the plugin's log file and maps stack frames back through source maps.
- `packages/devtools-server` — standalone authenticated HTTP/WebSocket backend,
  optional static UI directory, and a separate `/testing` runtime simulator.
- `packages/devtools-client` — TypeScript/Vite dashboard application; depends on
  the server only for development and tests. The CLI resolves its installed
  `dist` directory and passes it to the server.
- `packages/devtools-protocol` — shared DevTools protocol contract.
- `packages/react` (`@soundor/react`) — a react-reconciler renderer over
  `soundor:ui` with React Native–style components; also Portal, Modal and
  FocusScope. Tests live in the private `packages/react/testing` workspace and use the public
  Testing Library with the simulated runtime. `pnpm --filter @soundor/react test`
  delegates to that workspace to avoid renderer/test-tool dependency cycles.
- `packages/test-runtime` — framework-independent in-memory UI, semantics, events,
  services, parameters, and virtual animation clock.
- `packages/vitest` and `packages/vitest-environment-soundor` — the `soundor()`
  plugin and `environment: 'soundor'`, with isolated runtime state per test.
- `packages/testing-library` — semantic queries and stateful user interactions;
  `/react` renders through Soundor's reconciler. See `docs/testing.md`.
- `packages/create-soundor-app` — scaffolder from `templates/base`.
- `runtimes/engine` — independently versioned C++ engine, public headers, resources, dependency recipes, native tests, and the Hermes module-lowering tool.
- `runtimes/juce-runtime` — TypeScript codegen, JUCE resolution, scaffolding and the JUCE adapters in `native/backend/juce/`.
- `runtimes/web-runtime` — Node side (`src/`: lifecycle, Vite plugin, codegen)
  and the browser side (`src/client/`: parameter store, `WebHost`, DOM-backed
  `soundor:ui`, IndexedDB storage/fs, the host UI).
- `configs/*` — private shared tsconfig and tsdown presets.

### The cross-runtime contract

`soundor.config.ts` → generated contract → each runtime implements the same
`soundor:*` modules (`parameters`, `host`, `ui`, `native`, `storage`, `fs`)
and the same subset of Web globals. The web runtime deliberately reproduces
the JUCE runtime's semantics (parameter clamping/gestures, event routing,
Yoga layout defaults, error messages), so a behavior change in one runtime
usually needs the matching change in the other.

### Accessibility

Soundor owns its accessibility semantics: React props → `node.accessibility`
(`soundor:ui`) → the semantic tree (`a11y::SurfaceSemantics` natively; the
same rules in `web-runtime/src/client/ui/semantics.ts`) → a platform backend.
The backends are ARIA (web), AccessKit (Windows, Linux) and Soundor's own
Apple bridges (macOS, iOS). JUCE only supplies the native view; AccessKit
types never leave `src/a11y/accesskit/`. Keep the native and web rules in
step. Apple bridges must not register fixed Objective-C class names or
swizzle (see `runtimes/engine/src/a11y/apple/README.md`).

### init vs gen ownership

`init` writes user-owned host files once under `runtimes/<id>/` and never
overwrites them. `gen` regenerates `.soundor/generated/` (deterministic,
`soundor gen --check`). Code that belongs to every plugin goes in the
generated framework or the runtime package, not in `init` templates.

### Native runtime invariants (`runtimes/engine`)

- The core library is backend-independent and never includes JUCE; JUCE
  adapters live in `backend/juce/`. A third-party header (Hermes, Yoga, Skia,
  ANGLE) is included only by the directory that wraps it (Hermes's
  `hermes.h` only in `src/js/`, JSI through `src/js/Bindings.h`, EGL/GLES only
  in `src/gpu/`).
- Threading: JavaScript runs only on the UI/message thread. Audio-thread
  listeners only set lock-free flags; `RuntimeHost::tick()` (60 Hz from the
  generated editor) drains them, fires timers and settles async work.
  Background I/O hands back only plain C++ results plus an operation id.
- Only `jsi::JSError` (JSI's way of throwing into JavaScript) crosses into the
  engine: bindings run their bodies through `bind::invoke`, which turns any
  other C++ exception into one; engine errors come back as `Result<T>`.
- JavaScript the runtime runs is in its module form (a CommonJS module
  function, lowered for Hermes by `@soundor/core`'s `toNativeModule()`): the
  CLI's `bundle.js`, and the runtime's own modules, lowered from
  `runtimes/engine/src/**/*.js` while building (so native builds need Node and the
  installed dependencies). Production builds compile it with `hermesc` and
  link the VM without its compiler.
- Symbol isolation: several Soundor plugins share a host process, so
  everything is hidden-visibility, statically linked, and inside the inline
  namespace `soundor::SOUNDOR_ABI_NAMESPACE` (derived from the exact engine package version).
  `soundor_exported_symbols` and `soundor_coexistence` tests enforce it; a new
  dependency must keep its symbols hidden.
- Dependencies are pinned in `cmake/SoundorDependencies.cmake` (FetchContent,
  SHA-256 verified) and compiled into private static targets, not their own
  CMake projects. Skia, ANGLE and Hermes are built from source once per
  machine into the cache (ANGLE: gn decides what to compile, Soundor's CMake
  compiles it; Hermes by its own CMake, with Soundor's patches in
  `cmake/hermes/`).
- GPU code has a device only where there is one: tests skip without one,
  except under `SOUNDOR_REQUIRE_GPU=1` (CI), where they fail.
- GPU invariants: no WebGL read-back when the GPU compositor runs (frames
  count read-backs); static CPU layers are not re-rasterized or re-uploaded
  every frame; nothing waits for the GPU on the CPU (no `glFinish`); all of
  a device's contexts share textures, so WebGL contexts delete their own
  when they go; Apple code adds no Objective-C classes or categories.
- `juceRuntime({ engine: { mode } })`: `prebuilt` (default) links the release
  named by the published engine's `artifacts/manifest.json` (written by the
  release workflow, never committed); the workspace has none, so the
  examples use `source`. User-facing docs: `docs/engine.md`.
- Prebuilt engines (`runtimes/engine/README.md`, "Prebuilt engines") are the
  same build, staged and packed per target and variant (debug, release) by
  `.github/workflows/engine-prebuilts.yml`; the engine's CMake imports
  extracted archives (`SOUNDOR_ENGINE_PREBUILT_{DEBUG,RELEASE}_DIR`) as the
  targets a source build defines, after checking them. A new linked
  dependency needs its license notice in the archive (`runtimes/engine/licenses/`).
- Reload (dev) means destroying the `RuntimeHost` and creating a fresh one;
  teardown with pending jobs must be clean (debug builds assert that no JSI
  value outlives its context).
- Plugin builds (`soundor dev`/`build`) use Ninja on macOS and Linux and
  Visual Studio on Windows; the supported platforms are these three.
- macOS signing comes from `ctx.signing` (`SOUNDOR_MACOS_SIGNING_IDENTITY`,
  then `signing.macos.identity`, then ad-hoc) and is always the last build
  step (`soundor_finalize_plugin`); nothing may write into a bundle after it.
  Soundor never handles key material or notarization.

## Conventions

- TypeScript is formatted/linted by oxfmt/oxlint (not Prettier/ESLint); C++ by
  clang-format 18 / clang-tidy using the root `.clang-format`/`.clang-tidy`.
  The pre-commit hook runs lint-staged.
- Dependency versions live in the `catalog:` in `pnpm-workspace.yaml`
  (`catalogMode: strict`); `minimumReleaseAge` blocks very new releases.
- Releases are Changesets; the thirteen packages under `packages/` are a fixed version group.
  Add a changeset for any published-package change.
- PRs follow `.github/pull_request_template.md`.
