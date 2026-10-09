# AGENTS.md

This file provides guidance to coding agents (Claude Code, claude.ai/code and others) when working with code in this repository.

## What Soundor is

A toolchain for audio plugins whose UI is written once in TypeScript/React and
run by several **runtimes**. A project declares its plugin in
`soundor.config.ts` (identity, parameters, a typed `native` API, the runtimes);
the `soundor` CLI bundles `src/main.tsx` and drives each runtime through the
same lifecycle phases. Two runtimes exist:

- `@soundor/juce-runtime` (the reference): a JUCE plugin (VST3/AU/Standalone)
  hosting an embedded QuickJS runtime that runs the UI bundle, laid out with
  Yoga and drawn with Skia on the CPU.
- `@soundor/web-runtime`: the same plugin in a browser, with the DOM and Web
  Audio. Nothing native runs there (no WASM, QuickJS, Yoga or Skia).

The packages' READMEs are the authoritative spec of behavior (especially
`runtimes/juce-runtime/README.md`, `runtimes/juce-runtime/native/README.md`,
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
pnpm --filter @soundor/react exec vitest run src/modal.test.tsx -t "<test name>"
pnpm --filter soundor test                            # the CLI package is named `soundor`
```

`test` depends on `^build` in turbo, so filtered vitest runs need the
dependencies built first (`pnpm build` or `pnpm turbo run build --filter=<pkg>...`).

Native runtime (`runtimes/juce-runtime/native`, from that directory):

```sh
cmake --workflow --preset dev        # Debug, -Werror, doctest suites  → build/dev
cmake --workflow --preset sanitize   # ASan/UBSan/LSan                 → build/sanitize
cmake --workflow --preset tidy       # clang-tidy, build only          → build/tidy
cmake --workflow --preset juce       # + JUCE adapter tests (needs JUCE_DIR, e.g. /opt/JUCE)
ctest --test-dir build/dev -R <name> # one native test after a dev build
```

The first native configure builds Skia and ANGLE from source (minutes) and
caches them in the user cache dir (`SOUNDOR_CACHE` overrides); later
configures reuse them. `-DSOUNDOR_ENABLE_GPU=OFF` skips ANGLE.

Examples (`examples/basic`, `examples/primitives`, `examples/three`: a
Three.js benchmark) are real projects using the
workspace packages: `pnpm --filter <example> exec soundor dev web|juce`,
`... soundor build web|juce`.

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
  logger, errors, command running.
- `packages/cli` (`soundor`) — `init`, `gen`, `dev`, `build`, `doctor`. Loads
  the config, bundles the UI with tsdown (`src/ui/bundle.ts`: npm deps inlined,
  `soundor:*` left as imports), then calls each runtime's phase. `dev` tails
  the plugin's log file and maps stack frames back through source maps.
- `packages/react` (`@soundor/react`) — a react-reconciler renderer over
  `soundor:ui` with React Native–style components; also Portal, Modal and
  FocusScope. Tests use `src/testing/fake-ui.ts` in place of the runtime.
- `packages/create-soundor-app` — scaffolder from `templates/base`.
- `runtimes/juce-runtime` — TypeScript side (`src/`: codegen of the C++
  framework, JUCE resolution, scaffolding) plus the C++ runtime in `native/`.
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
swizzle (see `native/src/a11y/apple/README.md`).

### init vs gen ownership

`init` writes user-owned host files once under `runtimes/<id>/` and never
overwrites them. `gen` regenerates `.soundor/generated/` (deterministic,
`soundor gen --check`). Code that belongs to every plugin goes in the
generated framework or the runtime package, not in `init` templates.

### Native runtime invariants (`runtimes/juce-runtime/native`)

- The core library is backend-independent and never includes JUCE; JUCE
  adapters live in `backend/juce/`. A third-party header (QuickJS, Yoga, Skia,
  ANGLE) is included only by the directory that wraps it (`quickjs.h` only in
  `src/js/`, EGL/GLES only in `src/gpu/`).
- Threading: JavaScript runs only on the UI/message thread. Audio-thread
  listeners only set lock-free flags; `RuntimeHost::tick()` (60 Hz from the
  generated editor) drains them, fires timers and settles async work.
  Background I/O hands back only plain C++ results plus an operation id.
- No C++ exception crosses into the engine; errors become JavaScript errors
  and come back as `Result<T>`.
- Symbol isolation: several Soundor plugins share a host process, so
  everything is hidden-visibility, statically linked, and inside the inline
  namespace `soundor::SOUNDOR_ABI_NAMESPACE` (derived from `plugin.id`).
  `soundor_exported_symbols` and `soundor_coexistence` tests enforce it; a new
  dependency must keep its symbols hidden.
- Dependencies are pinned in `cmake/SoundorDependencies.cmake` (FetchContent,
  SHA-256 verified) and compiled into private static targets, not their own
  CMake projects. Skia and ANGLE are built from source once per machine into
  the cache (ANGLE: gn decides what to compile, Soundor's CMake compiles it).
- GPU code has a device only where there is one: tests skip without one,
  except under `SOUNDOR_REQUIRE_GPU=1` (CI), where they fail.
- Reload (dev) means destroying the `RuntimeHost` and creating a fresh one;
  teardown with pending jobs must be clean (debug QuickJS aborts on leaks).
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
- Releases are Changesets; the six core packages are a fixed version group.
  Add a changeset for any published-package change.
- PRs follow `.github/pull_request_template.md`.
