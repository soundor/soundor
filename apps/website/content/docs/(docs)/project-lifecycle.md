---
title: 'Project lifecycle'
description: 'Config → generated contract → UI bundle → runtime; file ownership and reloads.'
---

Soundor's CLI loads `soundor.config.ts`, generates the shared contract, bundles
the UI for development or production, and invokes the selected runtime. Each
runtime exposes the same four lifecycle phases.

## Commands and phases

| Command                   | Purpose                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `soundor gen`             | Regenerate shared declarations and runtime-specific framework files                                |
| `soundor gen --check`     | Verify generated output matches the current contract without writing it                            |
| `soundor dev <runtime>`   | Generate development bindings, bundle and watch the UI, and run one runtime's development workflow |
| `soundor build [runtime]` | Generate production bindings, bundle the UI, and build runtime output                              |
| `soundor doctor`          | Check the environment, configuration, and all configured runtimes' prerequisites                   |

`build` operates on all configured runtimes when its selector is
omitted. `dev` requires a runtime: `soundor dev juce` or `soundor dev web`.
For example, `soundor build web` builds only the browser host. Generation runs
before development and production builds; the standalone `gen` command is also
useful for refreshing types in an editor.

## File ownership

| Location              | Owner               | Editing rule                                                                               |
| --------------------- | ------------------- | ------------------------------------------------------------------------------------------ |
| `soundor.config.ts`   | You                 | Declare identity, parameters, native API, and runtime options                              |
| `src/`                | You                 | Shared UI and application logic                                                            |
| `lib/`                | You                 | Rust processor and controller library, dependencies, lockfile and tests                    |
| `rust-toolchain.toml` | You                 | Rust toolchain choice, generated once                                                      |
| `.soundor/generated/` | Soundor             | Regenerated declarations, manifests, and framework; change the config or generator instead |
| `.soundor/ui/`        | Soundor             | Development and production UI bundles, assets, and build metadata                          |
| `.soundor/dist/<id>/` | Build tools         | Runtime build trees and output                                                             |
| `.soundor/dev/`       | Development session | Build logs and session files                                                               |

`gen` creates a Rust starter crate when `lib/Cargo.toml` is absent,
preserving existing files. Existing crates keep their sources, tests and layout. It
regenerates the derived contract under `.soundor/`. `gen --check` only
compares that derived output and never creates starter files. Framework changes belong in the runtime package or generated code,
so existing projects can receive them without overwriting custom code.

## Configuration and generated types

Config loading bundles and evaluates `soundor.config.ts`, then validates the
result. Runtime entries are factory results such as `juceRuntime()` and
`webRuntime()`, rather than plain runtime IDs. Validation reports all problems
with paths into the configuration.

Shared generation writes `.soundor/generated/` declarations for parameters,
the configured native API, runtime modules, Web globals, and imported images.
It also writes the Rust SDK with config-specific types under
`.soundor/generated/rust/soundor/`, the crate `lib/` depends on.
Runtime generation adds its own implementation contract:

- JUCE generates CMake integration, processor/editor bases, and C++ native API
  declarations and bindings under `.soundor/generated/runtimes/juce/`.
- Web generates a manifest and the Rust controller contract under
  `.soundor/generated/runtimes/web/`.

The shared UI TypeScript project includes the generated declarations and uses
`lib: ["ES2023"]` without `DOM`. Browser host files use a separate configuration
with browser types. See [CLI bundling](/docs/cli/ui-bundle) and
[Configuration](/docs/cli/config).

## The UI bundle

The CLI finds the project's `src/index.tsx` (or an existing `src/main.tsx`) entry, with `.ts`, `.jsx`, and `.js`
alternatives, and bundles its npm imports with tsdown. `soundor:*` imports stay
external for the runtime to supply.

Each build produces `bundle.mjs`, one ES module, which every runtime starts
from: the web runtime loads it as it is, and the JUCE runtime lowers it into
the module form its engine runs. Images and fonts are bundled as
content-addressed assets. Development output includes source maps; production output is minified
and tree-shaken. `process.env.NODE_ENV` is replaced during bundling.

Native builds compile production JavaScript to Hermes bytecode and embed it in
the plugin. Web builds pass the ES module to Vite, which builds the browser host
and emits its static assets. Vite does not separately bundle the original shared
UI source.

## Development and reload

For JUCE, `dev` builds a debug plugin, uses the development UI files on disk,
and opens the VST3 when the project installs the host, otherwise the Standalone
when configured. [Development launch options](/docs/cli/dev#what-soundor-dev-juce-opens)
can override that choice. A successful UI rebuild destroys
the old `RuntimeHost` and creates a fresh one. Timers, subscriptions, gestures,
and pending work from the old UI end. Processor parameters and persisted data
can outlive the UI; local React state cannot.

For the web runtime, Vite serves the host. A changed UI build ID reloads the
page. Custom browser input edits follow Vite's own update behavior. In either runtime a
failed UI rebuild reports an error and keeps the last working UI build.

Rust crate edits rebuild through Cargo; UI-only edits do not recompile Rust.
Restart development after changes to `soundor.config.ts` or runtime C++ code.
Console output and uncaught errors reach the terminal, with native source maps
used to map UI stack frames back to TypeScript.

The CLI can also start a local DevTools session for a runtime that declares
support. The native plugin editor offers tree inspection, picking,
animation information, and measured rendering diagnostics. See
[CLI development](/docs/cli/dev).

## Production builds

`build` generates the contract and one production UI bundle, then runs the
selected runtimes' build phases. JUCE uses a Release build with bytecode-only
Hermes and no DevTools bridge; the browser runtime emits a static site with
relative asset URLs.

JUCE's default prebuilt mode selects matching released engine libraries or
compiles local sources for modified inputs or unpublished versions. Explicit
source mode always compiles them, caching heavy dependencies. Download and
integrity errors fail the build, as does a mismatched explicit CI artifact. See [Soundor Engine](/docs/engine).

On macOS, final bundle modification and signing have a fixed order: Soundor
writes the VST3 manifest before final signing and verification. Signing details
and the separate notarization workflow are documented in the
[JUCE guide](/docs/juce-runtime#signing-and-distributing-on-macos).

## Adding a runtime

Install its package and add its factory to `runtimes`. No runtime initialization
step is needed.
Both first-party runtimes run the shared Rust processor and controller.

Runtime authors implement `gen`, `dev`, `build`, and `doctor` with
[`@soundor/runtime-sdk`](/docs/contribute/runtime-sdk). Lifecycle context carries the project
paths, config, file system, logger, codegen sink, build mode, UI bundle, signing
settings, and optional development-session services. Runtimes own platform
behavior; the CLI owns common orchestration.
