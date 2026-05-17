## Requirements

### Requirement: Workspace uses Oxc tooling for quality checks

The workspace SHALL use Oxlint for JavaScript and TypeScript linting and Oxfmt for formatting and import sorting.

#### Scenario: Lint check runs with Oxlint

- **WHEN** the workspace lint check is executed
- **THEN** Oxlint runs against the repository sources without invoking Biome

#### Scenario: Format check runs with Oxfmt

- **WHEN** the workspace format check is executed
- **THEN** Oxfmt verifies repository formatting without invoking Biome

### Requirement: Oxc tooling is configured at the repository root

The workspace SHALL define root TypeScript configuration files for Oxlint and Oxfmt.

#### Scenario: Oxlint config is present

- **WHEN** the repository root is inspected
- **THEN** an `oxlint.config.ts` file defines the lint configuration used by workspace lint commands

#### Scenario: Oxfmt config is present

- **WHEN** the repository root is inspected
- **THEN** an `oxfmt.config.ts` file defines the formatter configuration used by workspace format commands

### Requirement: Formatting preserves current Biome formatter intent

The Oxfmt configuration SHALL preserve the current Biome formatter intent for line width, non-JSX JavaScript/TypeScript quote style, default JSX quote behavior, semicolons, and import organization where Oxfmt supports equivalent behavior.

#### Scenario: Formatter compatibility options are configured

- **WHEN** the Oxfmt configuration is inspected
- **THEN** it sets an 80-character print width, single non-JSX JavaScript/TypeScript quotes, semicolon formatting, and import sorting without overriding Oxfmt's default JSX quote behavior

### Requirement: Oxc tooling dependencies are root-only

The workspace SHALL install Oxlint and Oxfmt as root development dependencies and SHALL keep their versions in the pnpm catalog because strict catalog mode is enabled.

#### Scenario: Oxc dependencies are declared at the root

- **WHEN** workspace dependency manifests are inspected after migration
- **THEN** `oxlint` and `oxfmt` are declared only as root development dependencies

#### Scenario: Oxc dependency versions are catalog-managed

- **WHEN** the pnpm catalog is inspected after migration
- **THEN** `oxlint` and `oxfmt` are catalog entries

#### Scenario: EditorConfig behavior is supported where available

- **WHEN** Oxfmt runs in the workspace
- **THEN** supported EditorConfig keys are honored according to Oxfmt behavior while compatibility-critical options remain explicit in `oxfmt.config.ts`

### Requirement: Quality workflows run through Turborepo root tasks

The workspace SHALL expose lint and format check workflows through public scripts backed by Turborepo root tasks, and SHALL expose lint-fix and format-fix workflows through direct Oxc tool commands.

The workspace SHALL NOT define a package-level Turbo `lint` task when linting is handled by the root `//#lint:check` task.

#### Scenario: Root lint task runs

- **WHEN** the workspace lint script is executed
- **THEN** it runs Oxlint for the repository

#### Scenario: Root format task runs

- **WHEN** the workspace format script is executed
- **THEN** it runs Oxfmt in check mode for the repository

#### Scenario: Root fix tasks mutate files without caching

- **WHEN** the workspace lint-fix or format-fix script is executed
- **THEN** it runs the corresponding Oxc tool directly and may update repository files

### Requirement: Biome is removed from active tooling

The workspace SHALL NOT use Biome as an active dependency, config source, script command, CI step, or pre-commit quality command.

#### Scenario: Biome configs are absent

- **WHEN** the repository tooling configuration is inspected after migration
- **THEN** Biome configuration files are no longer present in the root, packages, or examples

#### Scenario: Biome commands are absent

- **WHEN** package scripts, CI steps, and lint-staged commands are inspected after migration
- **THEN** they do not invoke `biome`

#### Scenario: Biome dependencies are absent

- **WHEN** workspace dependency manifests and catalog entries are inspected after migration
- **THEN** `@biomejs/biome` is not declared as an active dependency
