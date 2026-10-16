# Project lifecycle

[Documentation](README.md) · [The idea](overview.md) · [Getting started](getting-started.md) · [Architecture](architecture.md)

**On this page**

- [Commands and phases](#commands-and-phases)
- [File ownership](#file-ownership)
- [Configuration and generated types](#configuration-and-generated-types)
- [The UI bundle](#the-ui-bundle)
- [Development and reload](#development-and-reload)
- [Production builds](#production-builds)
- [Adding a runtime](#adding-a-runtime)

Soundor's CLI loads `soundor.config.ts`, generates the shared contract, bundles
the UI for development or production, and invokes the selected runtime. Each
runtime exposes the same five lifecycle phases.

## Commands and phases

| Command                   | Purpose                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `soundor init [runtime]`  | Scaffold user-owned host files; preserve files that already exist                                  |
| `soundor gen`             | Regenerate shared declarations and runtime-specific framework files                                |
| `soundor gen --check`     | Verify generated output matches the current contract without writing it                            |
| `soundor dev <runtime>`   | Generate development bindings, bundle and watch the UI, and run one runtime's development workflow |
| `soundor build [runtime]` | Generate production bindings, bundle the UI, and build runtime output                              |
| `soundor doctor`          | Check the environment, configuration, and all configured runtimes' prerequisites                   |

`init` and `build` operate on all configured runtimes when their selector is
omitted. `dev` requires a runtime: `soundor dev juce` or `soundor dev web`.
For example, `soundor build web` builds only the browser host. Generation runs
before development and production builds; the standalone `gen` command is also
useful for refreshing types in an editor.

## File ownership

| Location              | Owner               | Editing rule                                                                               |
| --------------------- | ------------------- | ------------------------------------------------------------------------------------------ |
| `soundor.config.ts`   | You                 | Declare identity, parameters, native API, and runtime options                              |
| `src/`                | You                 | Shared UI and application logic                                                            |
| `runtimes/<id>/`      | You                 | Host project, DSP, runtime-specific API implementations, build customization               |
| `.soundor/generated/` | Soundor             | Regenerated declarations, manifests, and framework; change the config or generator instead |
| `.soundor/ui/`        | Soundor             | Development and production UI bundles, assets, and build metadata                          |
| `.soundor/dist/<id>/` | Build tools         | Runtime build trees and output                                                             |
| `.soundor/dev/`       | Development session | Build logs and session files                                                               |

`init` and `gen` deliberately have different ownership rules. Re-running `init`
can fill in missing files but never upgrades an existing user-owned processor
or editor. Framework changes belong in the runtime package or generated code,
so existing projects can receive them without overwriting custom code.

## Configuration and generated types

Config loading bundles and evaluates `soundor.config.ts`, then validates the
result. Runtime entries are factory results such as `juceRuntime()` and
`webRuntime()`, rather than plain runtime IDs. Validation reports all problems
with paths into the configuration.

Shared generation writes `.soundor/generated/` declarations for parameters,
the configured native API, runtime modules, Web globals, and imported images.
Runtime generation adds its own implementation contract:

- JUCE generates CMake integration, processor/editor bases, and C++ native API
  declarations and bindings under `.soundor/generated/runtimes/juce/`.
- Web generates a manifest and the `WebNativeApi` interface under
  `.soundor/generated/runtimes/web/`.

The shared UI TypeScript project includes the generated declarations and uses
`lib: ["ES2023"]` without `DOM`. Browser host files use a separate configuration
with browser types. See [CLI bundling](cli.md#the-plugin-ui-bundle) and
[Configuration](config.md).

## The UI bundle

The CLI finds the project's `src/main.tsx` entry, with `.ts`, `.jsx`, and `.js`
alternatives, and bundles its npm imports with tsdown. `soundor:*` imports stay
external for the runtime to supply.

Each build produces `bundle.mjs`, an ES module for the web, and `bundle.js`, the
native module form lowered for Hermes. Images are bundled as content-addressed
assets. Development output includes source maps; production output is minified
and tree-shaken. `process.env.NODE_ENV` is replaced during bundling.

Native builds compile production JavaScript to Hermes bytecode and embed it in
the plugin. Web builds pass the ES module to Vite, which builds the browser host
and emits its static assets. Vite does not separately bundle the original shared
UI source.

## Development and reload

For JUCE, `dev` builds a debug plugin, uses the development UI files on disk,
and launches the Standalone when configured. A successful UI rebuild destroys
the old `RuntimeHost` and creates a fresh one. Timers, subscriptions, gestures,
and pending work from the old UI end. Processor parameters and persisted data
can outlive the UI; local React state cannot.

For the web runtime, Vite serves the host. A changed UI build ID reloads the
page. Host-source edits follow Vite's own update behavior. In either runtime a
failed UI rebuild reports an error and keeps the last working UI build.

Restart development after changes to `soundor.config.ts` or native C++ code.
Console output and uncaught errors reach the terminal, with native source maps
used to map UI stack frames back to TypeScript.

The CLI can also start a local DevTools session for a runtime that declares
support. The native development Standalone offers tree inspection, picking,
animation information, and measured rendering diagnostics. See
[CLI development](cli.md#development).

## Production builds

`build` generates the contract and one production UI bundle, then runs the
selected runtimes' build phases. JUCE uses a Release build with bytecode-only
Hermes and no DevTools bridge; the browser runtime emits a static site with
relative asset URLs.

JUCE's default prebuilt mode verifies and links the engine libraries for the
installed engine version. Source mode compiles them, caching heavy dependencies.
A missing or incompatible prebuilt fails explicitly. It never silently changes
to source mode. See [Soundor Engine](engine.md).

On macOS, final bundle modification and signing have a fixed order: Soundor
writes the VST3 manifest before final signing and verification. Signing details
and the separate notarization workflow are documented in the
[JUCE guide](juce-runtime.md#signing-and-distributing-on-macos).

## Adding a runtime

Install its package, add its factory to `runtimes`, and run `soundor init <id>`.
Implement that host's audio and native API while keeping the UI contract shared.

Runtime authors implement `init`, `gen`, `dev`, `build`, and `doctor` with
[`@soundor/runtime-sdk`](runtime-sdk.md). Lifecycle context carries the project
paths, config, file system, logger, codegen sink, build mode, UI bundle, signing
settings, and optional development-session services. Runtimes own platform
behavior; the CLI owns common orchestration.

---

Previous: [Architecture](architecture.md) · Next: [Parameters and host automation](parameters.md)
