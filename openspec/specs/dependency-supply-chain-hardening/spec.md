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

The workspace SHALL continue to support dependency install, Oxc-based format and lint checks, build, and test workflows after the Biome-to-Oxc tooling migration.

#### Scenario: CI-equivalent checks run after migration

- **WHEN** the Biome-to-Oxc tooling migration is complete
- **THEN** dependency install, Oxc format checks, Oxc lint checks, build, and test commands complete successfully

### Requirement: Major dependency refresh preserves manual build approvals

The workspace SHALL keep dependency build-script approval decisions under human control during the Vite 8 dependency refresh.

#### Scenario: Build approval is required during install

- **WHEN** pnpm reports new or changed dependency build scripts during the Vite 8 migration
- **THEN** implementation pauses for a human to review and run the appropriate approval workflow

#### Scenario: Build approvals are not auto-granted

- **WHEN** dependency metadata is updated for the Vite 8 migration
- **THEN** build-script approval state is not automatically granted without human review
