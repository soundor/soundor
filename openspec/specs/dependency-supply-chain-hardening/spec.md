## Requirements

### Requirement: Workspace uses pnpm v11

The workspace SHALL declare pnpm v11 as its package manager and SHALL maintain a pnpm v11-compatible lockfile for dependency installation.

#### Scenario: Corepack installs workspace package manager

- **WHEN** a developer or CI environment runs Corepack installation for the workspace
- **THEN** Corepack resolves pnpm v11 from the workspace package manager metadata

#### Scenario: Frozen install uses committed lockfile

- **WHEN** `pnpm install --frozen-lockfile` is run after the upgrade
- **THEN** installation succeeds without requiring lockfile changes

### Requirement: Dependency installs enforce two-day release cooldown

The workspace SHALL configure dependency installation to require package versions to be at least 2880 minutes old before they are eligible for installation.

#### Scenario: New package version is inside cooldown window

- **WHEN** dependency resolution encounters a package version published less than 2880 minutes ago
- **THEN** pnpm blocks or avoids installing that package version according to pnpm v11 release-age behavior

#### Scenario: Package version is outside cooldown window

- **WHEN** dependency resolution encounters a package version published at least 2880 minutes ago
- **THEN** pnpm allows the package version to be installed if all other constraints pass

### Requirement: Dependency build scripts require explicit approval state

The workspace SHALL use pnpm v11's build approval configuration model and SHALL NOT rely on removed pnpm v10 build-script configuration fields.

#### Scenario: Removed build configuration is absent

- **WHEN** the workspace configuration is inspected after migration
- **THEN** removed pnpm v10 fields such as `ignoredBuiltDependencies` are not present

#### Scenario: Build approvals are reviewed manually

- **WHEN** implementation reaches dependency build-script approval
- **THEN** a human runs `pnpm approve-builds` and records the resulting approval decisions in workspace configuration

### Requirement: Existing verification workflows continue to pass

The workspace SHALL continue to support the existing dependency install, build, lint, and test workflows after the pnpm v11 migration.

#### Scenario: CI-equivalent checks run after migration

- **WHEN** the pnpm v11 migration is complete
- **THEN** dependency install, build, lint, and test commands complete successfully with the upgraded package manager
