---
'@soundor/core': minor
'@soundor/config': minor
'@soundor/runtime-sdk': minor
'soundor': minor
---

**Breaking:** runtimes and the CLI agree on a runtime API version. `RUNTIME_API_VERSION` (now 1) in `@soundor/config` is the version of what a runtime depends on of its host (the `Runtime` interface, `LifecycleContext`, the config it receives, the error protocol), independent of the package versions. `defineRuntime()` gives a runtime the version of the `@soundor/config` it is built with (`runtime.apiVersion`; a runtime without one implements 1), and `resolveRuntime()` refuses, with exit code 4 (`INCOMPATIBLE_RUNTIME`), one outside `MIN_RUNTIME_API_VERSION` to `RUNTIME_API_VERSION`, or one older than a config setting the project uses (`CONFIG_FEATURES`), naming its path. `soundor init`, `gen`, `dev`, `build` and `doctor` resolve every runtime they run before generating or bundling anything. `packages/config/runtime-api.json` records the contract, and a test fails when it changes, for the version to be raised if runtimes could notice.

The config schema rejects properties it does not have (`unknown property 'mapping' in @soundor/config 0.17.0`) instead of dropping them, and `parseConfig()` refuses a project whose own `@soundor/config` is of another release line than the CLI's (`ConfigError` of kind `compatibility`).

Errors are recognized across copies of the packages: `isSoundorError(value, code?)` checks a protocol every `SoundorError` carries (the brand `Symbol.for('soundor.error.v1')`, a string `code`, `issues`), and `isConfigError()` a `ConfigError`'s. `runPhase()` passes through, and `exitCodeFor()` classifies, an error a runtime threw from its own `@soundor/core`, where `instanceof` said no: a runtime's `ConfigError` or `EnvError` was wrapped as a `RuntimeError` with exit code 5. New: `RuntimeCompatibilityError` in core; `CONFIG_VERSION`, `RUNTIME_API_VERSION`, `MIN_RUNTIME_API_VERSION`, `CONFIG_FEATURES`, `HOST_RUNTIME_API`, `checkRuntimeCompatibility()`, `runtimeApiVersion()`, `checkProjectConfigVersion()`, `projectConfigVersion()` and `sameReleaseLine()` in config.

`@soundor/runtime-sdk` re-exports all of `@soundor/config` and `@soundor/core`, and is the one Soundor package a runtime depends on; its new `@soundor/runtime-sdk/client` entry has what a runtime's client code needs without Node (core's springs). `defineSoundorConfig()` returns a `SoundorConfig` instead of the literal type of what it is given, so a project's config type names only `@soundor/config`, not its runtimes' packages (which a `composite` project, as `create-soundor-app` makes, could not name). Parameter types for the UI come from `soundor gen`, as before. `soundor` and `@soundor/runtime-sdk` depend on `@soundor/config` instead of declaring it a peer: both run its code.

`soundor gen`, `init` and `doctor` exit when they fail: their progress spinner kept the process running after the error was printed.
