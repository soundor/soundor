---
title: 'Contributing'
description: 'Workspace setup, checks, native builds, examples, generation, and documentation conventions.'
---

This guide covers the monorepo. For building a plugin with published packages,
start with [Getting started](/docs/getting-started).

## Set up the workspace

Use Node.js 24 and pnpm 12, matching the root `package.json` and `.nvmrc`.

```sh
pnpm install
pnpm build
```

The workspace contains public packages under `packages/` and `runtimes/`,
private shared configs under `configs/`, application examples under `examples/`,
and rendering benchmarks under `tools/benchmark/`. See
[Architecture](/docs/architecture#package-responsibilities) for package ownership.

`pnpm build` builds TypeScript packages and tools; it does not compile the native
engine. Native checks build it separately. The first native configure compiles
Skia, ANGLE, and Hermes and caches them in the user cache directory;
`SOUNDOR_CACHE` overrides the location. Later builds reuse this cache.

## Run repository checks

```sh
pnpm format    # oxfmt and native clang-format checks
pnpm lint      # oxlint and native clang-tidy
pnpm build     # TypeScript checks and package bundles
pnpm test      # Vitest and the engine's native dev workflow
pnpm check     # all of the above, in order
```

TypeScript uses oxfmt and oxlint. Native C++ uses clang-format 18 and clang-tidy
with the root configuration. `pnpm format:fix` applies formatting;
`pnpm lint:fix` applies supported TypeScript lint fixes.

Root commands exclude application examples; root build/test also exclude tools.
Run example and benchmark commands explicitly when changing them. Turborepo test
tasks depend on dependency builds, so build dependencies before invoking Vitest
directly.

## Focus on one package

```sh
pnpm turbo run build --filter=@soundor/react...
pnpm --filter @soundor/react test
pnpm --filter soundor test
pnpm --filter @soundor/react-tests exec vitest run src/modal.test.tsx
```

The renderer delegates its suites to a private
[React test workspace](/docs/contribute/react-tests). This keeps testing tools out of the
renderer dependency graph. Application tests should use the public helpers in
the [testing guide](/docs/testing).

For frontend work, the [DevTools client guide](/docs/contribute/devtools-client) describes its
local simulator, unit/integration tests, Playwright coverage, and attachment to
a live native backend. The [server guide](/docs/contribute/devtools-server) describes testing
the protocol without a plugin.

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

## Change a shared behavior

Trace a behavior through the contract before changing an implementation:

1. Update config validation, declarations, and code generation when the public
   contract changes.
2. Keep native, web, and simulated runtime behavior aligned where applicable.
3. Update React props and helpers if they expose the behavior.
4. Add focused tests at the layer that owns the behavior.
5. Update the relevant guide or reference in `apps/website/content/docs/`.

Native code must preserve the thread, lifetime, symbol-isolation, dependency,
and GPU invariants described in [Architecture](/docs/architecture) and the
[engine reference](/docs/contribute/engine-reference). Keep framework-specific adapters out of
the backend-independent engine.

Dependencies use the workspace catalog in `pnpm-workspace.yaml`. Before editing
`turbo.json`, consult the docs shipped with the installed Turbo package, resolved
with `node -p "require.resolve('turbo/package.json')"`.

## Regenerate checked-in files

From the repository root:

```sh
UPDATE_GOLDEN=1 pnpm --filter @soundor/juce-runtime test
pnpm --filter @soundor/core build
pnpm --filter @soundor/core gen:runtime-types
pnpm --filter @soundor/juce-runtime gen:webgl
```

These update the native API golden C++, shared runtime declarations, and WebGL
bindings respectively. Use only the relevant generator, and include its output
in the change. The [WebGL code generation notes](/docs/contribute/webgl-codegen) explain the
IDL inputs.

## Measure performance changes

Use the [benchmark guide](/docs/contribute/benchmark) to compare a saved build and the changed
build alternately in the same session:

```sh
pnpm --filter soundor-benchmark bench --save main
pnpm --filter soundor-benchmark bench --against main
```

Save the baseline from the base branch before measuring the changed branch.
Timing drifts between sessions. Work counts such as layouts, native calls,
uploads, and readbacks do not depend on timing and help explain a change.

## Documentation and changesets

The documentation is the website, [soundor.dev](https://soundor.dev): guides and
references live in `apps/website/content/docs/`, `(docs)/` for plugin authors
and `contribute/` for work on Soundor itself. Each folder's `meta.json` orders
its sidebar, and a page's frontmatter gives its title and description. Write
`.md`; use `.mdx` only for a page that needs a component, such as
`<Example name="basic" />`, which embeds an example's web build. Readers can
edit an embedded example's UI code (`src/`, without tests) and see it run, so
that code may import only `react`, `@soundor/react`, `soundor:*` and its own
files.

Link pages by their site path (`/docs/react#hooks`) and repository files by
their GitHub URL. Write versions as placeholders such as
`%version:<package>%`, which the build fills in from the repository (the list is
in `apps/website/plugins/values.ts`). Package READMEs are
short entry points linking to their page on soundor.dev, so their links also
work on npm. Legal notices remain with the dependencies they describe;
benchmark reports remain with their recorded data.

Preview the site with `pnpm turbo run dev --filter=website`. Its build
(`pnpm turbo run build --filter=website`) fails on a broken internal link or
anchor. `pnpm --filter website test` runs its unit tests, and
`pnpm --filter website test:e2e` its browser tests on the built site.

Add a changeset for a published-package change with `pnpm changeset`. The
thirteen public packages under `packages/` form a fixed version group; runtime
packages have their own versioning. Follow the repository's
[pull request template](https://github.com/soundor/soundor/blob/main/.github/pull_request_template.md) and describe the
changed behavior and the checks run.
