---
'@soundor/core': minor
'@soundor/config': minor
'@soundor/runtime-sdk': minor
'soundor': minor
---

**Breaking:** runtimes declare the Soundor versions they support, and the CLI checks them. `defineRuntime()` requires `package: { name, version, compatibility }`, where `compatibility` is `{ config, core, schemas }`: version ranges of the host's `@soundor/config` and `@soundor/core`, and the config schema versions (`CONFIG_SCHEMA_VERSION`, now 1) the runtime implements in full, best read from `package.json`'s `soundor.compatibility`. `resolveRuntime()` checks them (`checkRuntimeCompatibility()`), and `soundor init`, `gen`, `dev`, `build` and `doctor` resolve every runtime they run before generating or bundling anything: a runtime outside them is refused with exit code 4 (`INCOMPATIBLE_RUNTIME`, or `INVALID_RUNTIME` for a declaration that cannot be read), naming the versions it supports and those it got. A runtime that declares nothing runs with a warning; a later release will refuse it.

The config schema rejects properties it does not have (`unknown property 'mapping' in @soundor/config 0.17.0 (config schema 1)`) instead of dropping them, and `parseConfig()` refuses a project whose own `@soundor/config` is of another release line than the CLI's (`ConfigError` of kind `compatibility`).

Errors are recognized across copies of the packages: `isSoundorError(value, code?)` checks a protocol every `SoundorError` carries (the brand `Symbol.for('soundor.error.v1')`, a string `code`, `issues`), and `isConfigError()` a `ConfigError`'s. `runPhase()` passes through, and `exitCodeFor()` classifies, an error a runtime threw from its own `@soundor/core`, where `instanceof` said no: a runtime's `ConfigError` or `EnvError` was wrapped as a `RuntimeError` with exit code 5. New in core: `CORE_VERSION`, `RuntimeCompatibilityError`, `satisfiesRange()`, `parseVersion()`, `compareVersions()`, `isValidRange()`, `sameReleaseLine()`; in config: `CONFIG_VERSION`, `CONFIG_SCHEMA_VERSION`, `HOST_VERSIONS`, `checkProjectConfigVersion()`, `projectConfigVersion()`.

`soundor` and `@soundor/runtime-sdk` depend on `@soundor/config` instead of declaring it a peer: both run its code.

`soundor gen`, `init` and `doctor` exit when they fail: their progress spinner kept the process running after the error was printed.
