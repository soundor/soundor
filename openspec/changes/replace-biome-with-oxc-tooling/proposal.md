## Why

The workspace currently uses Biome for formatting, linting, and import organization, while the desired tooling direction is the Oxc ecosystem with root-level Turborepo tasks. Moving to Oxlint and Oxfmt centralizes quality checks, removes package-level Biome wiring, and aligns formatter/linter execution with Turborepo's recommended root task pattern.

## What Changes

- Replace Biome linting with Oxlint using a root TypeScript config file.
- Replace Biome formatting and import organization with Oxfmt using a root TypeScript config file compatible with the current Biome formatter behavior.
- Omit Biome assist functionality except for replacing import organization with Oxfmt import sorting.
- Move lint, format, and fix workflows to Turborepo root tasks.
- Update CI and pre-commit/lint-staged quality checks to use Oxlint/Oxfmt instead of Biome.
- Remove Biome config files, package-level Biome lint scripts, and Biome dependencies/catalog entries; install Oxlint/Oxfmt only as root development dependencies while keeping versions in the pnpm catalog because the workspace uses strict catalog mode.

## Capabilities

### New Capabilities

- `workspace-oxc-quality-tooling`: Workspace-level linting and formatting are provided by Oxlint/Oxfmt through root configuration and Turborepo root tasks.

### Modified Capabilities

- `dependency-supply-chain-hardening`: Existing verification workflows continue to pass with Oxc tooling replacing Biome in dependency, lint, build, and test workflows.

## Impact

- Root tooling files: `package.json`, `turbo.json`, `pnpm-workspace.yaml`, lockfile, new `oxlint.config.ts`, and new `oxfmt.config.ts`.
- Package/example manifests that currently run `biome lint .` or depend on `@biomejs/biome`.
- Biome config files at the root and package/example level.
- CI workflow and lint-staged/pre-commit quality checks.
- Developer workflow commands for linting, formatting, and applying fixes.
