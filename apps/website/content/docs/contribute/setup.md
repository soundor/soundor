---
title: 'Setup'
description: 'Prepare the workspace, native toolchain, examples and website.'
---

## Set up the workspace

Use Node.js 24 and pnpm 12, matching the root `package.json` and `.nvmrc`.

```sh
pnpm install
pnpm build
```

The workspace contains public packages under `packages/` and `runtimes/`,
private shared configs under `configs/`, application examples under `examples/`,
and rendering benchmarks under `tools/benchmark/`. See
[Packages](/docs/contribute/packages) for package ownership.

`pnpm build` builds TypeScript packages and tools; it does not compile the native
engine. Native checks build it separately. The first native configure compiles
Skia, ANGLE, and Hermes and caches them in the user cache directory;
`SOUNDOR_CACHE` overrides the location. Later builds reuse this cache.

## Native checks

The engine builds without JUCE. From `runtimes/engine/`:

```sh
cmake --workflow --preset dev        # Debug, warnings as errors, doctest suites
cmake --workflow --preset sanitize   # ASan, UBSan, LSan
cmake --workflow --preset tidy       # clang-tidy and build
cmake --workflow --preset nogpu      # build and tests without ANGLE
ctest --test-dir build/dev -R <name> --output-on-failure
```

The last command runs a focused test after the dev build. Native builds need
the installed Node dependencies because JavaScript runtime modules and test
fixtures are lowered during the build. GPU-dependent tests skip without a
device unless `SOUNDOR_REQUIRE_GPU=1`, which makes its absence a failure.

JUCE adapter tests require an existing JUCE checkout. From
`runtimes/juce-runtime/native/`:

```sh
cmake --workflow --preset juce
```

From the repository root, build the source-engine JUCE test plugin with:

```sh
pnpm --filter @soundor/juce-runtime test:plugin
```

See the [engine reference](/docs/contribute/engine-reference#building-and-testing) for
embedding checks, and [Soundor Engine](/docs/engine) for source/prebuilt modes and
ABI compatibility.

## Run the examples

From the repository root, after `pnpm build`:

```sh
pnpm --filter basic exec soundor dev web
pnpm --filter basic exec soundor dev juce
pnpm --filter primitives exec soundor dev web
pnpm --filter basic test
pnpm --filter basic typecheck
pnpm --filter basic build:web
```

The native command needs JUCE and a display to launch the Standalone. Both
examples use source engine mode because workspace engines have no published
manifest. The examples are real applications; native CI uses the runtime's own
test plugin fixtures. See [Basic](/docs/examples/basic) and
[Primitives](/docs/examples/primitives).

## Run the website

```sh
pnpm turbo run dev --filter=website
```

This builds dependencies and the examples' web versions, synchronizes embedded
examples, builds the playground script and starts Vite. Open the URL it prints.
Docs content reloads as you edit it. The website depends on `build:web`, which
does not compile JUCE plugins.

```sh
pnpm turbo run build --filter=website
pnpm --filter website test
pnpm --filter website test:e2e
```

The production build prerenders the pages, checks internal links and anchors,
and typechecks the website. Browser tests need Playwright's Chromium and serve
the built site on port 4321.

## Native prerequisites

The workflow presets require CMake 3.25 or newer. Use Ninja and a C++ toolchain;
formatting uses clang-format 18 and analysis uses clang-tidy. Platform packages
and cache setup used by CI are recorded in
[native-deps/action.yml](https://github.com/soundor/soundor/blob/main/.github/actions/native-deps/action.yml).

Choose the compiler and generator before configuring a build directory. CMake
retains both in that directory; use a fresh build tree after switching either.
Plugin builds use Ninja on macOS and Linux and Visual Studio on Windows.
