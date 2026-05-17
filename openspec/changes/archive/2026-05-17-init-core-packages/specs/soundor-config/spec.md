## ADDED Requirements

### Requirement: ProjectConfig type

The package SHALL export a `ProjectConfig` TypeScript interface describing the shape of a `soundor.config.ts` file, including at minimum `name` (string), `runtime` (string), and `parameters` (array of `Parameter`).

#### Scenario: ProjectConfig is importable

- **WHEN** a consumer imports `ProjectConfig` from `@soundor/config`
- **THEN** TypeScript resolves the type without error

### Requirement: Parameter type

The package SHALL export a `Parameter` TypeScript interface with at minimum `id` (string) and `label` (string) fields.

#### Scenario: Parameter is importable

- **WHEN** a consumer imports `Parameter` from `@soundor/config`
- **THEN** TypeScript resolves the type without error

### Requirement: parseConfig utility

The package SHALL export a `parseConfig(path: string): Promise<ProjectConfig>` function that reads and returns a config object from the given path.

#### Scenario: parseConfig returns stub config in stub implementation

- **WHEN** `parseConfig` is called with any path
- **THEN** it returns a `Promise` that resolves to a value satisfying `ProjectConfig`

#### Scenario: parseConfig is importable

- **WHEN** a consumer imports `parseConfig` from `@soundor/config`
- **THEN** TypeScript resolves the function without error
