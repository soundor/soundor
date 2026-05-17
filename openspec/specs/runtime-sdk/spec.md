## ADDED Requirements

### Requirement: Runtime interface

The package SHALL export a `Runtime` TypeScript interface that runtimes must implement, with at minimum `dev(config: ProjectConfig): Promise<void>` and `build(config: ProjectConfig, options: BuildOptions): Promise<void>` methods.

#### Scenario: Runtime interface is importable

- **WHEN** a consumer imports `Runtime` from `@soundor/runtime-sdk`
- **THEN** TypeScript resolves the interface without error

#### Scenario: A class implementing Runtime satisfies the type

- **WHEN** a class implements all required methods with correct signatures
- **THEN** TypeScript accepts it as `Runtime` without error

### Requirement: BuildOptions type

The package SHALL export a `BuildOptions` TypeScript interface with at minimum a `mode` field typed as `'debug' | 'production'`.

#### Scenario: BuildOptions is importable

- **WHEN** a consumer imports `BuildOptions` from `@soundor/runtime-sdk`
- **THEN** TypeScript resolves the type without error

### Requirement: SoundorError class

The package SHALL export a `SoundorError` class extending `Error` that accepts a message string.

#### Scenario: SoundorError is throwable and catchable

- **WHEN** a `SoundorError` is thrown and caught
- **THEN** `error instanceof SoundorError` is `true` and `error.message` matches the constructor argument
