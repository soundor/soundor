## 1. Dependencies and Configuration

- [ ] 1.1 Add `oxlint` and `oxfmt` as root workspace development dependencies, not pnpm catalog entries.
- [ ] 1.2 Create root `oxlint.config.ts` with the initial workspace lint configuration.
- [ ] 1.3 Create root `oxfmt.config.ts` with Biome-compatible formatter settings: `printWidth: 80`, `singleQuote: true` for non-JSX strings, `semi: true`, `sortImports: true`, deterministic package JSON sorting, and no explicit `jsxSingleQuote` override.

## 2. Turborepo Root Tasks

- [ ] 2.1 Add root package scripts for Oxlint and Oxfmt lint, format, and fix commands.
- [ ] 2.2 Add Turborepo root tasks for `//#lint`, `//#lint:fix`, `//#format`, and `//#format:fix`.
- [ ] 2.3 Mark mutating root fix tasks as non-cacheable.

## 3. Remove Biome Wiring

- [ ] 3.1 Remove root and package/example Biome configuration files.
- [ ] 3.2 Remove package/example `biome lint .` scripts or replace them with root-task-compatible commands as appropriate.
- [ ] 3.3 Remove `@biomejs/biome` from package manifests and the pnpm catalog without adding Oxlint/Oxfmt to the catalog.
- [ ] 3.4 Regenerate the pnpm lockfile to remove Biome packages and add Oxc tooling packages.

## 4. Update Automation

- [ ] 4.1 Replace CI Biome format checks with Oxfmt checks.
- [ ] 4.2 Replace CI Biome linting with Oxlint root task execution.
- [ ] 4.3 Update lint-staged/pre-commit commands to use Oxfmt and Oxlint instead of Biome.

## 5. Normalize and Verify

- [ ] 5.1 Run Oxfmt fix mode once to normalize formatting and import sorting.
- [ ] 5.2 Run Oxlint and resolve reported lint violations or adjust rules deliberately.
- [ ] 5.3 Run CI-equivalent verification: dependency install, format check, lint check, build, and test.
- [ ] 5.4 Inspect the repository for any remaining active Biome references and remove them.
