# AGENTS.md

This file provides guidance to coding agents (Claude Code, claude.ai/code and others) when working with code in this repository.

## What Soundor is

A toolchain for audio plugins whose UI is written once in TypeScript/React and
run by several **runtimes**. A project declares its plugin in
`soundor.config.ts` (identity, parameters, a typed `native` API, the runtimes);
the `soundor` CLI bundles `src/main.tsx` and drives each runtime through the
same lifecycle phases. Two runtimes exist:

- `@soundor/vst3-runtime` (the reference): a VST3 plugin for Linux x86_64,
  macOS and Windows x64 (each building for itself), with no JUCE and no C++
  compiled per plugin: a generic VST3 adapter (Steinberg's SDK), prebuilt per
  platform and engine variant and released on GitHub as the engine's archives
  are (the package's manifest names them; a build downloads its own into the
  Soundor cache), hosting the engine
  and the project's Rust crate, which Cargo compiles with the runtime's
  `soundor-vst3` crate (the plugin's descriptor and UI) and the platform's
  linker links (`c++`, MSVC's `link.exe`). The engine runs the UI bundle in an
  embedded Hermes runtime (interpreted, bytecode compiled at build time); the
  crate's processor runs on the audio thread and its required controller (the
  Rust behind `soundor:native`'s methods) on the control thread. The UI is
  laid out with Yoga and drawn with Skia Ganesh, with CPU drawing as a
  fallback. Soundor's own compositor puts the layers together on the GPU
  (ANGLE: Metal, Direct3D 11, Vulkan) where it can, and on the CPU otherwise.
  The editor is a child window of the host's (X11, including through
  XWayland; NSView; HWND). Canvas nodes have a 2D context (Skia) and a WebGL 2
  context (ANGLE), which the GPU compositor shows without copies; Three.js
  runs on it unmodified.
- `@soundor/web-runtime`: the same plugin in a browser, with the DOM and Web
  Audio, without Hermes or Skia. Its `soundor:ui` is the engine itself
  (`@soundor/engine/web`): the engine's C++ core (node tree, styles, Yoga,
  text layout) compiled to WebAssembly, and a DOM adapter that shows the tree
  as HTML elements placed where the engine lays them out; CSS only draws.

The guides in `apps/website/content/docs/` are the authoritative spec of
behavior, published at https://soundor.dev: `(docs)/` for plugin authors
(especially `vst3-runtime.md`, `web-runtime.md`, `react.mdx`), `components/`
(a page per `@soundor/react` component, its props table generated from its
type and doc comments), `hooks/`, `api/` (a page per `soundor:*` module),
`testing/`, `cli/` (commands, config, create-soundor-app), and `contribute/`
for internals (especially `engine-reference.md`). Keep them in
sync when behavior changes; a prop or a `Style` property needs a doc comment,
which its table shows.

## Commands

pnpm 12 + Node 24 monorepo driven by Turborepo. Root build excludes apps,
examples and tools. Root tests include website unit tests, but exclude examples
and tools.

```sh
pnpm install
pnpm build            # tsc -b && tsdown in every package
pnpm test             # package unit tests (no native engine compilation; the web runtime's
                      # use the published WebAssembly core, built with Emscripten only
                      # when the core's sources differ from it, see below)
pnpm test:native      # engine source build and native tests (dev preset), and the VST3 host's
pnpm lint             # oxlint
pnpm lint:native      # clang-tidy (cmake --workflow --preset tidy)
pnpm check:native     # native lint and tests
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

Native runtime (`engine`, from that directory):

```sh
cmake --workflow --preset dev        # Debug, -Werror, doctest suites  → build/dev
cmake --workflow --preset sanitize   # ASan/UBSan/LSan                 → build/sanitize
cmake --workflow --preset tidy       # clang-tidy, build only          → build/tidy
cmake --workflow --preset nogpu      # without ANGLE (as on iOS)        → build/nogpu
cmake --workflow --preset bench      # Release soundor_run_ui (benchmarks) → build/bench
cmake --workflow --preset wasm       # the WebAssembly core (Emscripten wasm/emscripten.json pins, from EMSDK) → build/wasm/web/soundor-core.wasm
pnpm build:wasm && pnpm test:wasm && pnpm test:browser  # the same, staged in build/wasm/stage, then its Node and Chromium suites
cmake --workflow --preset prebuilt-debug    # stage a prebuilt engine (also -release; needs
                                            # SOUNDOR_ENGINE_SOURCE_COMMIT) → build/prebuilt-*/stage
SOUNDOR_ENGINE_PREBUILT_DIR=<extracted> cmake --workflow --preset prebuilt-check-debug  # tests against one
ctest --test-dir build/dev -R <name> # one native test after a dev build
```

The VST3 runtime (`runtimes/vst3-runtime`; its `build` and `test` never compile
native code). A workspace builds its own prebuilt adapter, which every VST3
build (examples included) links; build it again after an engine edit:

```sh
pnpm --filter @soundor/vst3-runtime build:native   # the prebuilt adapter, both variants, against engine()
pnpm --filter @soundor/vst3-runtime test:native    # its native tests
pnpm --filter @soundor/vst3-runtime lint:native    # clang-tidy
xvfb-run -a pnpm --filter @soundor/vst3-runtime test:plugin  # its test plugin in the VST3 host
pnpm --filter @soundor/vst3-runtime exec soundor build vst3 --debug --config tests/plugin/soundor.config.ts  # the Debug build the real-plugin suites load
```

The VST3 host (`hosts/vst3-host`; its `build` and `test` never compile it):

```sh
pnpm --filter @soundor/vst3-host test:native    # dev preset, self-test, fixtures, integration tests
pnpm --filter @soundor/vst3-host build:native   # select or build the executable (prepareHost)
(cd hosts/vst3-host && cmake --workflow --preset tidy)      # clang-tidy
(cd hosts/vst3-host && node scripts/native.ts test --preset sanitize)
```

The first native configure builds Skia, ANGLE and Hermes from source
(minutes) and caches them in the user cache dir (`SOUNDOR_CACHE` overrides);
later configures reuse them. `-DSOUNDOR_ENABLE_GPU=OFF` skips ANGLE. Native
builds need Node and `pnpm install`: the runtime's JavaScript modules (and the
tests' Three.js) are lowered with the engine's module-lowering source while building.

Examples (`examples/basic`, `examples/orbit`, `examples/primitives`, `examples/analyzer`,
`examples/controller` (the same Rust controller in native and web), and
`examples/snippets`) are real projects using the workspace packages. The docs'
live snippets are web-only. Run `pnpm --filter <example> dev` (VST3) or `dev:web`,
`build:vst3` or `build:web`. CI's Workspace job runs their tests, typecheck and web
builds, and the website embeds those web builds. Orbit also has end-to-end tests
of its Debug VST3 (`pnpm --filter orbit test:e2e`), the one example a native CI
job builds. Tests have their own fixtures, inside the package they test:
`runtimes/vst3-runtime/tests/plugin`.

The website (`apps/website`) embeds the examples' web builds:

```sh
pnpm turbo run build --filter=website   # packages, examples' build:web, the site → apps/website/dist/client
pnpm turbo run dev --filter=website     # the site with live content reload
pnpm --filter website test              # unit tests: placeholders, link check, examples sync, playground, editor types
pnpm --filter website test:e2e          # browser tests of the built site (Playwright), incl. editing an example
```

It depends on the examples' `build:web` only (`website#build` in `turbo.json`),
never their `build`, which would build the VST3 plugin.
Its build fails on a broken internal link or anchor, or an incomplete page
(`scripts/links.ts`). Its unit tests need nothing built (`website#test` has no
dependencies), so the root `test` runs them. `.github/workflows/website.yml` deploys it: called
by the release workflow after npm publishing, or run by hand.

Native CI jobs follow their package and run when `turbo query affected`
reports it (`.github/scripts/native-changes.mjs`). Each group is a reusable
workflow called from `verify.yml`, so its jobs show as `<group> / <job>`: Engine
(`engine.yml`; its suites ← `@soundor/engine`), VST3 (vst3-runtime) (`vst3.yml`) ← `@soundor/vst3-runtime`, VST3 (host) (`vst3-host-artifacts.yml`) ← `@soundor/vst3-host`,
Orbit E2E (`orbit.yml`) ← `orbit`, and Benchmark smoke ← `soundor-benchmark`. A change
only under `hosts/vst3-host/` runs VST3 (host) and Orbit E2E alone. The engine and the host
share one pattern: `engine-plan` and `host-plan` select, one group builds and
checks (Engine, VST3 (host)), and jobs wait for it and consume the artifact or the release. What a job
builds must therefore be a dependency of its package. A package's workflow
runs that package's checks only: the engine's never builds or tests a runtime
(the VST3 runtime is tested in `vst3.yml`, against the engine's artifacts), and a new
runtime gets its own workflow rather than steps in another's.

The release (`release.yml`) builds, then tests, then publishes: each released
package's own build and checks (the engine in `engine-prebuilts.yml`'s
`build` phase, the host in `vst3-host-artifacts.yml`), then what uses them
(`vst3.yml` when the engine or the VST3 runtime is released, its adapters
built against the archives to be published), and only when all of it passed the engine's prebuilt
release (`release` phase), the VST3 runtime's adapter release (`vst3-release`,
`.github/scripts/vst3-adapters.mjs`), npm and the website.

Benchmarks (`tools/benchmark`: rendering scenarios for WebGL, Canvas 2D and
UI updates in the native engine, headless; see `contribute/benchmark.md`). Measure an optimization against a saved
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

- `UPDATE_GOLDEN=1 pnpm --filter @soundor/vst3-runtime test` — the test
  plugin's descriptor and the expression corpus in
  `runtimes/vst3-runtime/native/tests/generated`, read by its native tests;
  `pnpm --filter @soundor/vst3-runtime gen:expression` also rewrites the
  adapter's copy of the expression helpers. (`engine/tests/generated`, the
  native tests' `soundor:native` fixture, is maintained by hand.)
- `UPDATE_FIXTURES=1 pnpm --filter @soundor/web-runtime exec vitest run src/fixtures.test.ts`
  — the Web runtime's generated client fixtures in `src/client/testing/`.
- `UPDATE_GOLDEN=1 ./build/dev/tests/soundor_runtime_tests --test-suite="layout corpus"`
  (from `engine`, after a dev build) — the engine's frames in
  `tests/layout/corpus.json`, for a change meant to change layout.
- `pnpm --filter @soundor/engine gen:webgl` — the WebGL bindings and
  their declarations, `packages/environment/webgl.d.ts`. The other
  `packages/environment/*.d.ts` are written by hand.

Turborepo here may be newer than what you know: before changing `turbo.json`,
read the docs bundled with the installed package
(`node -p "require.resolve('turbo/package.json')"`, then its `docs/`).

## Architecture

### Packages

- `packages/config` — `defineSoundorConfig`, the zod schema, `parseConfig`
  (reports every problem with its path), config loading (bundled with rolldown).
  Also defines the `Runtime` interface types.
- `packages/expression` — `@soundor/expression`: a typed, pure,
  JSON-serializable expression language (AST, builder, checks) and its C++ and
  JavaScript compilers, with identical semantics checked by a differential
  test. Config resolves every parameter into expressions (`ParameterSemantics`:
  mapping, snapping, format, parse); runtimes only compile them. See the docs'
  `contribute/expression.md`.
- `packages/runtime-sdk` — `defineRuntime()`, which turns a runtime definition
  (`gen`, `dev`, `build`, `doctor`) into the factory a config calls
  (`vst3Runtime({...})`).
- `packages/core` — shared toolchain code: codegen of `.soundor/generated`
  (`@soundor/environment`'s declarations copied, plus `soundor:parameters`
  and `soundor:native` from the config), paths, logger, errors, command
  running. Its one dependency is `@soundor/environment`.
- `packages/environment` — types only, the source of every declaration that
  is the same for all plugins: `soundor:ui`, `soundor:host`,
  `soundor:storage`, `soundor:fs`, asset imports and the runtime's Web
  globals. Written by hand, except `webgl.d.ts`. Libraries use it (`"types":
  ["@soundor/environment"]`); core copies it into each project.
- `packages/cli` (`soundor`) — `gen`, `dev`, `build`, `doctor`. Loads
  the config, bundles the UI with tsdown (`src/ui/bundle.ts`: npm deps inlined,
  `soundor:*` left as imports) into one ES module, `bundle.mjs`, then calls
  each runtime's phase. A runtime that runs another form makes it: the VST3
  runtime lowers the bundle for Hermes (`src/ui.ts`) with the
  `toNativeModule()` of the engine it links (`@soundor/engine/native-module`). `dev` tails
  the plugin's log file and maps stack frames back through source maps.
  It ships the Rust SDK (`rust/soundor`), which `gen` copies into each
  project with `src/plugin.rs` generated from the config (`src/library/`; the
  SDK's own is from `rust/fixture/soundor.config.ts`, `UPDATE_GOLDEN=1`): the
  `Processor`, and the `Controller` with its generated `NativeMethods`, both
  exported by `soundor::export!`. See the docs' `rust-processor.md` and
  `rust-controller.md`.
- `packages/devtools-server` — standalone authenticated HTTP/WebSocket backend,
  optional static UI directory, and a separate `/testing` runtime simulator.
- `packages/devtools-client` — TypeScript/Vite dashboard application; depends on
  the server only for development and tests. The CLI resolves its installed
  `dist` directory and passes it to the server.
- `packages/devtools-protocol` — shared DevTools protocol contract.
- `packages/driver` (`@soundor/driver`) — Soundor Driver: a Node.js control
  client of a running DevTools session (the dashboard's authenticated
  `/browser` transport, never a runtime): targets, tree and node inspection,
  lazy locators (`getByDebugId`, role, text), and input (`pointer`,
  `keyboard`, locator actions with actionability waits) that the engine
  dispatches like a platform's (`src/debug/Input.cpp`, the `input`
  capability; never by calling handlers), and screenshots (`capture`: the
  engine renders and encodes PNG, the bridge uploads it as binary to the
  server, clients read it back as a short-lived authenticated resource). The
  CLI's `soundor driver`
  commands use it. Nodes get a `debugId` from the components' `debugId` prop.
  Its `@soundor/driver/vst3` entry (`launch()`) starts a private session, the
  VST3 host and the plugin's editor, for one script to work with UI and audio.
- `packages/react` (`@soundor/react`) — a react-reconciler renderer over
  `soundor:ui` with React Native–style components; also Portal, Modal and
  FocusScope. Tests live in the private `packages/react/testing` workspace and use the public
  Testing Library with the simulated runtime. `pnpm --filter @soundor/react test`
  delegates to that workspace to avoid renderer/test-tool dependency cycles.
- `packages/test-runtime` — framework-independent in-memory UI, semantics, events,
  services, parameters, and virtual animation clock.
- `packages/vitest` and `packages/vitest-environment-soundor` — the `soundor()`
  plugin and `environment: 'soundor'`, with isolated runtime state per test.
- `packages/vitest-e2e` — Vitest tests of a built VST3 plugin in the real VST3
  host: the `soundor({ vst3 })` plugin (no build logic), `launchPlugin()`,
  `launchHost()` (both closed when the test ends), retrying locator matchers,
  `toMatchScreenshot`, failure reports in `.soundor/test-results/`, and audio
  helpers (signals, measurements, `render()`, WAV files, audio matchers).
  Runs in Node, with the Driver underneath; the host is a required peer.
- `packages/testing-library` — semantic queries and stateful user interactions;
  `/react` renders through Soundor's reconciler. See the docs' `testing.md`.
- `packages/create-soundor-app` — scaffolder from `templates/base`.
- `engine` — independently versioned C++ engine, public headers, resources, dependency recipes, native tests, and the Hermes module-lowering tool.
  Also the engine in the browser: `wasm/` compiles the shared core
  (`cmake/SoundorCoreSources.cmake`, the same sources the native runtime
  compiles) to `soundor-core.wasm` with a pinned Emscripten
  (`wasm/emscripten.json`; `pnpm --filter @soundor/engine build:wasm`), and
  `web/src/` is `@soundor/engine/web`: the module's loader and command
  protocol (`core.ts`, `protocol.ts`; `PROTOCOL_VERSION` with
  `wasm/Engine.h`'s `protocolVersion`) and the DOM adapter that is the web
  runtime's `soundor:ui` (`ui/`). The module is never committed or in the npm
  package: it is an archive of the prebuilt release (target `web`, its own
  input fingerprint, `webInputs()` in `scripts/engine-inputs.mjs`). `node/` is
  the package's Node API, `engine({ target, mode })` (`.` export): prepares the
  web module or a native archive (prebuilt, published or source; the shared
  content-addressed cache; `SOUNDOR_ENGINE_WASM`), following the VST3 host's
  rules: integrity or network failures are errors, never a reason to build.
  See `contribute/web-engine.md` and the docs' `engine.md`.
- `runtimes/vst3-runtime` — the VST3 runtime (Linux, macOS, Windows): `native/` the adapter
  (`libsoundor_vst3.a`: component, controller, editor, descriptor, expression
  interpreter, generic `soundor:state`/`presets`/`native`), `rust/` the
  private ABI's Rust side, `src/` descriptor, generated crate, link and
  bundle, `src/adapter.ts` which adapter a build links, `tests/` its test
  plugin. `prebuilt/` is built (`pnpm --filter @soundor/vst3-runtime
  build:native`), never committed or packed: the published package's
  `artifacts/manifest.json` (written by the release workflow) names the
  adapter release's archives instead; see `contribute/vst3-runtime.md`.
- `runtimes/web-runtime` — Node side (`src/`: lifecycle, Vite plugin, codegen,
  `engine-wasm.ts`, the one place that calls `engine({ target: 'web' })`) and the
  browser side (`src/client/`: parameter store, `WebHost`, the page's engine
  as `soundor:ui`, IndexedDB storage/fs, the host UI in Preact under
  `src/client/shell/`).
- `hosts/vst3-host` (`@soundor/vst3-host`) — a standalone VST3 host: a C++
  executable (VST3 SDK 3.8.1, native windows; no JUCE, no engine) and the
  Node API that launches it (`launchHost()`), over a framed stdin/stdout
  protocol (`protocol.json`). Independently versioned; its executables ship as
  generated platform packages (`targets.json`, `scripts/release.ts`), never
  committed. `@soundor/driver` has it as an optional peer, for its `vst3` entry, and
  `@soundor/vst3-runtime` as a required one, for `soundor dev`, which opens
  the plugin in it. See `contribute/vst3-host.md`.
- `configs/*` — private shared tsconfig and tsdown presets.
- `apps/website` — soundor.dev (private, never published): Fumadocs on
  TanStack Start, prerendered to static files for GitHub Pages. Content in
  `content/docs/` (`.md`, or `.mdx` where a page uses a component such as
  `<Example name>`); `%version:<package>%` and `%node%` in content are
  replaced at build time (`plugins/values.ts`). Its examples can be edited
  in the page: the web runtime's playground mode (`?playground=<script>`,
  same origin only) runs the code the site's playground script
  (`playground/`, React + `@soundor/react` + Sucrase) is sent.
  `<Snippet name>` runs one file of `examples/snippets/src/snippets/` in the
  host's `?embed` presentation (the view alone, filling the iframe), its
  code inlined at build time (`plugins/remark-snippets.ts`). The editor
  (`src/editor/`) runs TypeScript's language service in a worker over the
  example's declarations (`types.json`, from `scripts/types.ts`); it uses
  the catalog's `typescript-6`, the last TypeScript with a JavaScript API.

### The cross-runtime contract

`soundor.config.ts` → generated contract → each runtime implements the same
`soundor:*` modules (`parameters`, `host`, `ui`, `native`, `storage`, `fs`)
and the same subset of Web globals. The web runtime deliberately reproduces
the VST3 runtime's semantics (parameter behavior, from the same
expressions, and gestures, event routing, error
messages), so a behavior change in one runtime usually needs the matching change
in the other. Layout is the same C++ in both: styles are read by
`ui/StyleReader.cpp` and laid out by `ui/Surface.cpp`, natively and in the
WebAssembly core, and `engine/tests/layout/corpus.json` holds the
engine's frames, which the web adapter's tests must match exactly.

### Dependencies and compatibility

A package declares what its emitted code or declarations import as
`dependencies`; peers are only for what the project must share (React,
Vitest, Vite, the VST3 host), or declares a plugin host (`soundor` for
runtime packages). Values crossing packages are recognized by
protocol, never by `instanceof` or module identity: a project can hold
several copies of `@soundor/core` (`isSoundorError()`, `isConfigError()`).
A runtime imports its toolchain APIs from `@soundor/runtime-sdk`, which
re-exports all of config and core; `defineSoundorConfig` returns a plain `SoundorConfig`, so a
project's config type never names a runtime's packages.
Runtime packages declare supported CLI versions through a required `soundor`
peer dependency (`workspace:^` for first-party runtimes, published as a caret
range). `@soundor/runtime-sdk` remains a regular dependency; it and `soundor`
share the fixed package version. Before 1.0, a caret range supports the current
minor and its patches. Providers own compatibility and widen the peer range
only for versions they support; package managers handle mismatches. The CLI
has no runtime-version check or config-feature version gates. See
`contribute/compatibility.md`.

### Accessibility

Soundor owns its accessibility semantics: React props → `node.accessibility`
(`soundor:ui`) → the semantic tree (`a11y::SurfaceSemantics` natively; the
same rules in `engine/web/src/ui/semantics.ts`) → a platform backend.
The backends are ARIA (web), native AT-SPI over system GDBus (Linux), native UI Automation
(Windows) and Soundor's own Apple bridges (macOS, iOS). The plugin's editor only supplies the native view; UI Automation
types never leave `src/a11y/windows/`. Keep the native and web rules in
step. Apple bridges must not register fixed Objective-C class names or
swizzle (see `contribute/apple-accessibility.md`).

### Source and generated file ownership

`gen` creates the shared Rust starter crate when `lib/Cargo.toml` is absent and never overwrites existing
user files. Both first-party hosts are package-managed; no runtime host
directories or initialization hooks are needed. `gen` regenerates
`.soundor/generated/` deterministically; `soundor gen --check` is read-only
and checks derived output only. Shared plugin code belongs in the generated
framework or runtime package, rather than user-owned starter templates.

### Native runtime invariants (`engine`)

- The core library is backend-independent and never includes a plugin
  format's SDK; the VST3 adapter lives in `runtimes/vst3-runtime/native/`. A third-party header (Hermes, Yoga, Skia,
  ANGLE) is included only by the directory that wraps it (Hermes's
  `hermes.h` only in `src/js/`, JSI through `src/js/Bindings.h`, EGL/GLES only
  in `src/gpu/`).
- The Rust controller (`processor::RustController`, `src/js/RustMethods.cpp`)
  is generic: it reads the methods and types from the controller descriptor
  (`describeController()`), never from generated per-plugin C++, and its
  callbacks and completions run only from `pump()` on the control thread.
- Threading: JavaScript runs only on the UI/message thread. Audio-thread
  listeners only set lock-free flags; `RuntimeHost::tick()` (60 Hz from the
  editor) drains them, fires timers and settles async work.
  Background I/O hands back only plain C++ results plus an operation id.
- Only `jsi::JSError` (JSI's way of throwing into JavaScript) crosses into the
  engine: bindings run their bodies through `bind::invoke`, which turns any
  other C++ exception into one; engine errors come back as `Result<T>`.
- JavaScript the runtime runs is in its module form (a CommonJS module
  function, lowered for Hermes by the engine's `toNativeModule()`,
  `scripts/native-module.ts`): the plugin's `bundle.js` (the VST3 runtime
  lowers the CLI's `bundle.mjs`), and the runtime's own modules, lowered from
  `engine/src/**/*.js` while building (so native builds need Node and the
  installed dependencies). Production builds compile it with `hermesc` and
  link the VM without its compiler.
- Symbol isolation: several Soundor plugins share a host process, so
  everything is hidden-visibility, statically linked, and inside the inline
  namespace `soundor::SOUNDOR_ABI_NAMESPACE` (derived from the exact engine package version).
  `soundor_exported_symbols` and `soundor_coexistence` tests enforce it; a new
  dependency must keep its symbols hidden.
- HTTP is the system's, never bundled: `platform::systemHttpClient()` is
  `NSURLSession`, WinHTTP, or the system's libcurl loaded at run time
  (`libcurl.so.4`, else `libcurl-gnutls.so.4`); `fetch()` and the DevTools
  bridge (`debug::Bridge`) use it. Do not link an HTTP or TLS library into
  the engine: the system keeps them patched.
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
- `engine({ target, mode })`, which the VST3 runtime calls: `prebuilt`
  (default) compares native build-input fingerprints and selects matching
  binaries or local sources.
  Release metadata comes from the published engine's `artifacts/manifest.json`
  (written by the release workflow, never committed); the workspace resolves
  the exact published npm manifest. Examples use the default prebuilt mode.
  Explicit CI manifests must match; download failures never select source.
  User-facing docs: the docs' `engine.md`.
- Prebuilt engines (`contribute/engine-reference.md`, "Prebuilt engines") are the
  same build, staged and packed per target and variant (debug, release, and on Windows
  debug-static and release-static for the static C runtime) by
  `.github/workflows/engine-prebuilts.yml`; the engine's CMake imports
  extracted archives (`SOUNDOR_ENGINE_PREBUILT_{DEBUG,RELEASE}_DIR`) as the
  targets a source build defines, after checking them. A new linked
  dependency needs its license notice in the archive (`engine/licenses/`).
- Reload (dev) means destroying the `RuntimeHost` and creating a fresh one;
  teardown with pending jobs must be clean (debug builds assert that no JSI
  value outlives its context).
- Plugin builds (`soundor dev`/`build`) compile no C++: Cargo, then the
  platform's linker (`c++` on Linux and macOS, `link.exe` on Windows). The
  adapter's own build (`build:native`) uses Ninja on macOS and Linux and
  Visual Studio on Windows; the supported platforms are these three.
- macOS signing comes from `ctx.signing` (`SOUNDOR_MACOS_SIGNING_IDENTITY`,
  then `signing.macos.identity`, then ad-hoc) and is always the last build
  step; nothing may write into a bundle after it.
  Soundor never handles key material or notarization.

## Conventions

- TypeScript is formatted/linted by oxfmt/oxlint (not Prettier/ESLint); C++ by
  clang-format 18 / clang-tidy using the root `.clang-format`/`.clang-tidy`.
  The pre-commit hook runs lint-staged.
- Keep lint warning-free. Run `pnpm lint` and `pnpm exec oxfmt --check`
  before finishing changes; run the affected package's native lint for C++
  changes (the VST3 host uses `tidy:native`). Warnings fail the JS lint gate,
  and clang-tidy already treats warnings as errors. Fix the cause rather than
  weakening rules. For an intentional construct or a demonstrated false
  positive, use the narrowest exception and explain why it is necessary.
- Dependency versions live in the `catalog:` in `pnpm-workspace.yaml`
  (`catalogMode: strict`); `minimumReleaseAge` blocks very new releases.
- Releases are Changesets; the seventeen packages under `packages/` are a fixed version group;
  `@soundor/engine`, `@soundor/vst3-runtime`,
  `@soundor/web-runtime` and `@soundor/vst3-host` are versioned on their own.
  Add a changeset for any published-package change.
- PRs follow `.github/pull_request_template.md`.
