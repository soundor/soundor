## 1. Dependencies and Configuration

- [x] 1.1 Add `oxlint` and `oxfmt` as root workspace development dependencies with versions managed by the pnpm catalog.
- [x] 1.2 Create root `oxlint.config.ts` with the initial workspace lint configuration.
- [x] 1.3 Create root `oxfmt.config.ts` with Biome-compatible formatter settings: `printWidth: 80`, `singleQuote: true` for non-JSX strings, `semi: true`, `sortImports: true`, deterministic package JSON sorting, and no explicit `jsxSingleQuote` override.

## 2. Turborepo Root Tasks

- [x] 2.1 Add public root check scripts that run Oxlint and Oxfmt through Turbo, plus direct fix scripts for mutating commands.
- [x] 2.2 Add Turborepo root tasks for `//#lint:check` and `//#format:check`.
- [x] 2.3 Keep mutating fix scripts out of Turbo because they are uncached file-writing commands.

## 3. Remove Biome Wiring

- [x] 3.1 Remove root and package/example Biome configuration files.
- [x] 3.2 Remove package/example `biome lint .` scripts or replace them with root-task-compatible commands as appropriate.
- [x] 3.3 Remove `@biomejs/biome` from package manifests and the pnpm catalog while keeping Oxlint/Oxfmt catalog entries for strict catalog mode.
- [x] 3.4 Regenerate the pnpm lockfile to remove Biome packages and add Oxc tooling packages.

## 4. Update Automation

- [x] 4.1 Replace CI Biome format checks with Oxfmt checks.
- [x] 4.2 Replace CI Biome linting with Oxlint root task execution.
- [x] 4.3 Update lint-staged/pre-commit commands to use Oxfmt and Oxlint instead of Biome.

## 5. Normalize and Verify

- [x] 5.1 Run Oxfmt fix mode once to normalize formatting and import sorting.
- [x] 5.2 Run Oxlint and resolve reported lint violations or adjust rules deliberately.
- [x] 5.3 Run CI-equivalent verification: dependency install, format check, lint check, build, and test.
- [x] 5.4 Inspect the repository for any remaining active Biome references and remove them.
