## Context

The workspace is a pnpm/Turborepo monorepo with packages under `packages/*`, shared configs under `configs/*`, and examples under `examples/*`. Biome is currently configured at the repository root for formatting, linting, VCS ignore integration, and assist-driven import organization. Package-level Biome configs extend the root config to enable React lint behavior.

The desired end state is an Oxc-based quality tooling stack: Oxlint for linting and Oxfmt for formatting/import sorting. The implementation should use TypeScript config files and Turborepo root tasks so quality tooling is configured and executed from the repository root rather than duplicated across packages.

## Goals / Non-Goals

**Goals:**
- Replace Biome completely with Oxlint and Oxfmt.
- Preserve current formatter intent: 80-character print width, single quotes for non-JSX JavaScript/TypeScript strings, default JSX quote behavior, semicolons, EditorConfig-aware whitespace behavior where supported, and import organization via Oxfmt import sorting.
- Use root TypeScript config files: `oxlint.config.ts` and `oxfmt.config.ts`.
- Use Turborepo root tasks for lint, format, lint fix, and format fix workflows.
- Update CI and lint-staged/pre-commit workflows to run Oxc tooling.
- Remove Biome config files, package-level Biome scripts, and Biome dependencies.

**Non-Goals:**
- Preserve Biome assist features other than import organization behavior replaced by Oxfmt import sorting.
- Add type-aware Oxlint checks unless required by the base migration.
- Introduce Prettier or maintain compatibility with Prettier plugins.
- Redesign unrelated build, test, or package publishing workflows.

## Decisions

### Use Oxlint for linting

Oxlint will replace Biome's linter. It provides fast JavaScript/TypeScript linting and supports ESLint-style rule configuration from a TypeScript config file.

Alternatives considered:
- Keep Biome for linting: rejected because the desired direction is complete Biome removal.
- Use ESLint: rejected because the requested target is Oxc tooling.

### Use Oxfmt for formatting and import sorting

Oxfmt will replace Biome's formatter and the import organization behavior currently provided by Biome assist. The formatter config should explicitly set compatibility-critical options instead of relying only on defaults.

The root `oxfmt.config.ts` should include the closest compatible mapping:
- `printWidth: 80` for Biome `formatter.lineWidth: 80`.
- `singleQuote: true` for Biome `javascript.formatter.quoteStyle: "single"`, covering non-JSX JavaScript/TypeScript strings.
- Leave `jsxSingleQuote` unset so Oxfmt keeps its default JSX attribute quote behavior.
- `semi: true` to preserve semicolon formatting intent.
- `sortImports: true` to replace Biome `assist.actions.source.organizeImports: "on"`.
- `sortPackageJson: true` to keep package JSON formatting deterministic.

Oxfmt reads `.editorconfig` automatically for supported keys, but the compatibility-critical print width should remain explicit in `oxfmt.config.ts` because Oxfmt's default print width differs from the current Biome config.

Alternatives considered:
- Keep Biome only for formatting: rejected because Biome should be removed completely.
- Add Prettier: rejected because the repository does not currently use Prettier and Oxfmt is the selected formatter.

### Use TypeScript config files

The root config files will be `oxlint.config.ts` and `oxfmt.config.ts`. This matches the existing repository preference for TypeScript-based tool configs such as Vite, Vitest, and tsdown config files.

Alternatives considered:
- Use `.oxlintrc.jsonc` and `.oxfmtrc.jsonc`: rejected because TypeScript configs were requested and provide better editor typing.

### Install Oxc tools as root-only dependencies

Oxlint and Oxfmt will be installed in the root `devDependencies`, not in the pnpm catalog, because they are only invoked by root-level tooling tasks and are not shared package dependencies.

Alternatives considered:
- Add `oxlint` and `oxfmt` to the pnpm catalog: rejected because the tools are root-only and do not need catalog coordination across workspaces.

### Use Turborepo root tasks

Lint and format workflows will run as root tasks using Turborepo's `//#task` convention. Fixing tasks should be marked non-cacheable because they mutate files.

The root tasks should cover:
- `//#lint` for `oxlint .`
- `//#lint:fix` for `oxlint --fix .`
- `//#format` for `oxfmt --check`
- `//#format:fix` for `oxfmt .`

Package-level `biome lint .` scripts should be removed or replaced so Biome is no longer invoked from package workspaces.

Alternatives considered:
- Keep per-package lint scripts: rejected because the requested model is root config plus root Turborepo tasks.

## Risks / Trade-offs

- Oxfmt formatting is not guaranteed to be byte-for-byte identical to Biome formatting → Mitigation: configure known compatibility options explicitly and run `oxfmt .` once during implementation to normalize formatting.
- Oxfmt import sorting is not a perfect replacement for Biome organize imports → Mitigation: treat `sortImports: true` as the intended replacement and review any import-order churn in implementation.
- Oxfmt EditorConfig support differs from Biome/editor expectations → Mitigation: keep critical formatting options in `oxfmt.config.ts`; rely on `.editorconfig` only for supported whitespace/editor behavior.
- Oxlint rules do not map one-to-one with Biome rules → Mitigation: start with a practical root Oxlint configuration, then adjust rules based on actual lint output during implementation.
- Root tasks can invalidate broadly when config or tool versions change → Mitigation: accept broad invalidation for centralized quality tooling; mark mutating fix tasks as non-cacheable.

## Migration Plan

1. Add `oxlint` and `oxfmt` as root workspace development dependencies, not pnpm catalog entries.
2. Add root `oxlint.config.ts` and `oxfmt.config.ts`.
3. Add Turborepo root tasks for lint, format, and fix commands.
4. Replace CI and lint-staged Biome invocations with Oxlint/Oxfmt commands.
5. Remove package/example Biome scripts, Biome config files, and Biome dependencies.
6. Regenerate the pnpm lockfile.
7. Run format, lint, build, and test verification.

Rollback is straightforward: revert the tooling changes and restore Biome config/dependencies if Oxfmt or Oxlint produces unacceptable behavior.

## Open Questions

- None.
