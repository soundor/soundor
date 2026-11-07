---
title: 'Workflow'
description: 'Select checks, regenerate derived files and prepare a pull request.'
---

## Run repository checks

```sh
pnpm format    # oxfmt and native clang-format checks
pnpm lint      # oxlint
pnpm build     # TypeScript checks and package bundles
pnpm test      # package unit tests and engine tooling tests (no native compilation)
pnpm check     # all of the above, in order
pnpm test:native  # engine source build and native tests
pnpm lint:native  # native source build with clang-tidy
pnpm check:native # both native checks
```

TypeScript uses oxfmt and oxlint. Native C++ uses clang-format 18 and clang-tidy
with the root configuration. `pnpm format:fix` applies formatting;
`pnpm lint:fix` applies supported TypeScript lint fixes.

Root build excludes apps, examples and tools. Root tests include website unit tests but exclude examples and tools.
Run example and benchmark commands explicitly when changing them. Turborepo test
tasks depend on dependency builds, so build dependencies before invoking Vitest
directly.

Native CI uses affected-package detection before allocating native runners.
When the engine is affected, the read-only `engine.yml` workflow
builds and validates Debug and
Release artifacts for Linux, macOS and Windows. Windows uses two runners in
parallel: one for the dynamic C runtime (`/MD`, `/MDd`), the other for the static
C runtime (`/MT`, `/MTd`), each with its own dependency cache. Consumers merge
the two Windows artifacts before selecting an engine. JUCE jobs consume those
artifacts from the same run and commit instead of rebuilding the engine. When it is not
affected, JUCE uses a matching released engine. If the current version is
unpublished or its inputs do not match the release, an unchanged package in a
pull request can instead use complete artifacts from a successful `main` push.
CI matches the native input fingerprint and the build recipe, including the
pinned toolchain setup, and requires all platform artifacts to remain available.
These artifacts and their lookup indexes are retained for seven days. A miss
builds checkout artifacts; an API or integrity failure fails the job.

The VST3 host uses the same selection: a matching published binary, then matching
`main` artifacts for unchanged packages in pull requests, then a source build.
The jobs that use it never compile it themselves. Engine and host changes still
run their native checks. `main` builds same-commit artifacts for release publishing;
reused PR artifacts retain the original build's commit and provenance.
Sanitizers, GCC, no-GPU builds and static analysis keep their own configurations.
Benchmarks retain source builds because their Release runner supports JavaScript
source; the shipped Release engine is bytecode-only.

Missing or mismatched CI artifacts fail verification; there is no fallback to an
older engine. Release publishing waits for verification of the same main commit and reuses
its validated engine artifacts rather than rebuilding them.

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
pnpm --filter @soundor/juce-runtime gen:webgl
```

These update the native API golden C++, and the WebGL bindings with their
declarations (`packages/environment/webgl.d.ts`) respectively. The other
declarations in `packages/environment` are written by hand. Use only the relevant generator, and include its output
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

## Prepare a pull request

Describe the concrete behavior or reader experience that changes, why it
changes, and the checks run. Follow the
[pull request template](https://github.com/soundor/soundor/blob/main/.github/pull_request_template.md).
Keep related implementation, generated files, tests and documentation together.

Add a changeset for a published-package change with `pnpm changeset`. The
sixteen public packages under `packages/` form a fixed version group; the
engine and runtime packages have their own versions. The source of truth is
[Changesets config](https://github.com/soundor/soundor/blob/main/.changeset/config.json).
Before 1.0, breaking changes use a `minor` changeset. Website-only documentation
changes do not need a package release.

Native CI jobs follow affected packages, in groups that show as `<group> / <job>`,
each a reusable workflow called from `verify.yml`:

| Group                                        | Workflow                  | Follows                 | What it does                                                                                     |
| -------------------------------------------- | ------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| Engine                                       | `engine.yml`              | `engine-plan`           | Builds the engine for every target and, when it is affected, its static analysis and test suites |
| VST3 (host)                                  | `vst3-host-artifacts.yml` | `host-plan`             | Builds and tests the host                                                                        |
| JUCE 8 (juce-runtime), JUCE 9 (juce-runtime) | `juce.yml`                | `@soundor/juce-runtime` | Adapters and a real plugin                                                                       |
| Orbit E2E                                    | `orbit.yml`               | `orbit`                 | End-to-end tests of a real plugin                                                                |

What uses the engine or the host waits for its whole group, so it starts from one that
passed. Benchmark smoke follows `soundor-benchmark`. A change only under `hosts/vst3-host/`
runs VST3 (host) and Orbit E2E alone. Verify is the one required check, and it runs for pull
requests into `main`. Each build input must be a dependency of the package whose
job consumes it. See
[native-changes.mjs](https://github.com/soundor/soundor/blob/main/.github/scripts/native-changes.mjs)
and [verify.yml](https://github.com/soundor/soundor/blob/main/.github/workflows/verify.yml).
