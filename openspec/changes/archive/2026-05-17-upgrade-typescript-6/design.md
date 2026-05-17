## Context

The workspace currently pins TypeScript `^5.9.3` through the pnpm catalog and resolves `5.9.3` in the lockfile. The codebase is already close to TS6 expectations: packages are ESM, TypeScript configs use `moduleResolution: "bundler"`, `module: "ESNext"`, `strict: true`, and modern React/Vite settings.

The upgrade still crosses multiple validation surfaces: the React package builds with `tsdown --clean` and `dts: true`, the basic example builds with `tsc -b && vite build`, and the workspace validates with Vitest, oxlint, oxfmt, and Turborepo. The highest-risk area is declaration generation through `tsdown`, because it relies on TypeScript behavior and compiler-compatible declaration emit.

## Goals / Non-Goals

**Goals:**

- Upgrade the workspace to TypeScript 6 with a clean lockfile and deterministic pnpm catalog state.
- Preserve existing package outputs and public API shape for `@soundor/react`.
- Make TypeScript configuration explicit where TS6 default changes could alter behavior.
- Validate library build, example build, tests, linting, and formatting after the upgrade.
- Prefer resolving TS6 warnings directly over adding long-term suppression.

**Non-Goals:**

- Refactor application or package source code beyond changes needed for TS6 compatibility.
- Change React, Vite, Vitest, tsdown, oxlint, or oxfmt versions unless TS6 validation proves it necessary.
- Introduce new runtime behavior or public APIs.
- Remove `skipLibCheck` permanently as part of this change unless required for TS6 correctness.

## Decisions

### Upgrade TypeScript independently first

Change only the TypeScript catalog entry and lockfile initially, then run validation before touching adjacent tools.

Alternatives considered:

- Upgrade all tooling in one batch. This is faster but makes failures harder to attribute.
- Delay TS6 until every tool explicitly documents support. This is safer but unnecessary because current versions are modern and `tsdown` has TS6 support in its release line.

### Treat `tsdown` declaration generation as the primary compatibility gate

The React package uses `tsdown` with `dts: true`, and package exports point to `./dist/index.d.ts`. A successful TS6 migration must prove declaration generation still works, not just source type-checking.

Alternatives considered:

- Validate only with `tsc --noEmit`. This misses the packaged declaration output path.
- Temporarily disable declaration generation. This would break the package contract and is not acceptable.

### Make TS6-sensitive defaults explicit only when they matter

The example configs already set `types` explicitly. The shared React library config should be reviewed for explicit ambient typing or output assumptions, but only changed if validation shows drift or ambiguity.

Alternatives considered:

- Add explicit `types` or `rootDir` everywhere preemptively. This can reduce ambiguity but risks narrowing ambient type discovery or changing output layout unnecessarily.
- Rely entirely on TS6 defaults. This is smaller but makes future failures harder to diagnose.

### Avoid long-term `ignoreDeprecations`

If TS6 emits deprecation warnings, resolve the underlying config where practical. `ignoreDeprecations` may be used only as a temporary bridge if a third-party dependency or upstream tool blocks completion.

Alternatives considered:

- Add `ignoreDeprecations: "6.0"` immediately. This reduces noise but hides upgrade work that should be addressed now.

## Risks / Trade-offs

- TS6 exposes declaration emit failures in `tsdown` → Validate `packages/react` build and emitted `dist/index.d.ts`; upgrade `tsdown` only if required.
- TS6 default `types` behavior changes ambient typings → Verify app, node, library, and test type-checking; add explicit `types` only where needed.
- `skipLibCheck` hides dependency type incompatibilities → Keep normal builds aligned with existing config, but perform at least one diagnostic pass that can reveal dependency typing issues if practical.
- pnpm install state is currently not ready for non-interactive validation → Start implementation with a clean `pnpm install --frozen-lockfile` or equivalent CI-safe install.
- Updating only TypeScript may uncover peer/tool constraints → Attribute failures before broadening package upgrades.

## Migration Plan

1. Ensure dependencies are installed cleanly in a normal dev or CI environment.
2. Run the current TS5.9 baseline validation before making dependency changes.
3. Upgrade the TypeScript catalog entry and regenerate the lockfile.
4. Run targeted type-checks and builds for the React package and basic example.
5. Run workspace tests, lint, format check, and full build.
6. Address config or toolchain incompatibilities with minimal scoped changes.
7. Roll back by reverting the TypeScript catalog and lockfile changes if TS6 compatibility is blocked by upstream tooling.

## Open Questions

- Will `tsdown --clean` with `dts: true` produce the same declaration entrypoint under TypeScript 6 without additional config?
- Does the shared React library config need explicit `types` under TS6, or is import-based type discovery sufficient?
- Will a dependency type diagnostic pass reveal issues currently hidden by `skipLibCheck`?
