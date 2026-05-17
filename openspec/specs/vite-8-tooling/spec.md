## Requirements

### Requirement: Workspace uses Vite 8

The workspace SHALL declare a Vite 8-compatible dependency baseline through the central pnpm catalog.

#### Scenario: Vite catalog targets major version 8

- **WHEN** the workspace catalog is inspected after migration
- **THEN** the `vite` catalog entry resolves to Vite major version 8

#### Scenario: Consumers use catalog version

- **WHEN** package manifests declare Vite as a development dependency
- **THEN** they continue to consume Vite through the workspace catalog rather than package-local versions

### Requirement: Vite-adjacent tooling remains compatible

The workspace SHALL use Vite-adjacent tooling versions that are compatible with Vite 8 for the existing app and test workflows.

#### Scenario: React plugin supports Vite 8

- **WHEN** the basic example app builds with Vite
- **THEN** the configured `@vitejs/plugin-react` version supports the installed Vite 8 version

#### Scenario: Vitest supports Vite 8

- **WHEN** package tests run through Vitest
- **THEN** the configured Vitest version supports the installed Vite 8 version

### Requirement: Existing Vite app behavior is preserved

The Vite 8 migration SHALL preserve the existing basic example app build behavior.

#### Scenario: Basic example builds

- **WHEN** the basic example build command runs after migration
- **THEN** TypeScript compilation and `vite build` complete successfully

#### Scenario: Vite config remains minimal

- **WHEN** the basic example Vite config is inspected after migration
- **THEN** it keeps the existing React plugin configuration unless Vite 8 compatibility requires a documented change

### Requirement: Existing test workflow is preserved

The Vite 8 migration SHALL preserve the existing Vitest workflow for the React package.

#### Scenario: React package tests pass

- **WHEN** the React package test command runs after migration
- **THEN** Vitest completes the existing `happy-dom` test suite successfully

### Requirement: Migration validates workspace workflows

The implementation SHALL validate the dependency refresh with install, test, build, and example-app checks.

#### Scenario: Workspace validation passes

- **WHEN** the migration is complete
- **THEN** dependency installation, workspace tests, workspace build, and the basic example build complete successfully
