---
title: 'Publishing a runtime'
description: 'Package entry points, dependencies, Soundor and engine compatibility, and consumer validation.'
---

## Purpose

A runtime package needs to work from an installed tarball in a plugin project,
with the matching Soundor contracts and platform resources available. A workspace
build alone does not establish that packaging boundary.

## Where the code is

Use `runtimes/juce-runtime/package.json` and `runtimes/web-runtime/package.json`
as reference manifests. The engine's public ABI and prebuilt checks are documented in
[Soundor Engine](/docs/engine#abi-versioning) and the
[engine reference](/docs/contribute/engine-reference#prebuilt-engines).

## How it works

```mermaid
flowchart TD
    package["Runtime tarball: factory, types and resources"] --> project["Installed plugin project"]
    deps["Runtime SDK and core dependencies, declared compatibility"] --> project
    engine["Exact engine package, when used"] --> project
    project --> init["Initialize and generate"]
    init --> verify["Doctor, dev and production consumer checks"]
```

### Name and exports

Choose a descriptive npm name such as `soundor-runtime-<platform>` or a scoped
equivalent. This is a naming recommendation, not a discovery mechanism: the
config imports the package's factory explicitly. Choose a stable runtime ID
that does not collide with other runtimes in the same config.

Export the ESM factory and its TypeScript declarations through `exports`.
Include the generated JavaScript, declarations and runtime resources in the
package's `files` list. Resolve packaged templates, CMake support or browser
resources relative to `import.meta.url`, rather than the consumer's current
working directory. Exercise those paths from an installed tarball.

### Dependencies and compatibility

The reference runtimes import their toolchain APIs from `@soundor/runtime-sdk`,
which re-exports all of `@soundor/config` and `@soundor/core`: their code
imports everything from it, and their declarations name nothing else. A
project's config type names only its own `@soundor/config`
(`defineSoundorConfig` returns a `SoundorConfig`), so the runtime's packages
need not be installed in the project. Client code, which runs with the
plugin's UI rather than in Node, imports from `@soundor/runtime-sdk/client`
(no Node code); the web runtime inlines it into its browser client. Review the emitted entry point and declarations (`dist/*.mjs`,
`dist/*.d.mts`) to check that every package they import is declared. See
[Dependencies and compatibility](/docs/contribute/compatibility) for the rules.

Keep `@soundor/runtime-sdk` as a regular dependency and declare `soundor` as a
required peer at the host versions you support:

```json
{
  "dependencies": { "@soundor/runtime-sdk": "^%version:@soundor/runtime-sdk%" },
  "peerDependencies": { "soundor": "^%version:soundor%" }
}
```

The SDK and CLI are released at the same version. Before 1.0, a caret range
supports the current minor and its patches. Test each new Soundor minor and
publish an updated peer range when the runtime supports it. Package managers
handle mismatches; the CLI does not perform another runtime-version check.

Before 1.0, plugin projects pin exact Soundor versions. Document your runtime's
tested versions and upgrade steps. Keep your package version and the engine ABI
version distinct: they describe different compatibility boundaries.

### Engine compatibility

An engine-based runtime depends on the exact engine version it was built
against. That selects its headers, libraries, bytecode compiler and inline ABI
namespace together. Do not use a semver-compatible engine library with headers
from another exact version. Source and prebuilt modes must preserve the same
contract and version checks.

An independent runtime, such as the web implementation, does not link the C++
engine. It still needs compatible declarations and observable module behavior.

## Invariants and tests

Check a packed installation in a fresh consumer (as
`packages/cli/scripts/runtime-consumer-smoke.mjs` does for the reference
runtimes): import the factory, load config,
initialize twice, generate and check, run doctor, and exercise development and
production output. Include assets and user-defined native API types in the
fixture so missing package resources or dependencies are exposed.

Add the execution and platform coverage from
[Conformance](/docs/contribute/build-runtime/conformance). For engine embeddings,
also check symbol isolation and coexistence with another plugin binary. Keep
dependency notices with any native dependency archives you distribute.

## How to change it

When changing exports, dependency ranges or packaged files, run consumer checks
against the packed result. Treat an engine upgrade as a rebuild of every
component tied to its ABI and bytecode. Document required user-owned host-file
edits; new `init` templates cannot migrate existing files automatically.
