## Context

The workspace currently centralizes dependency versions in `pnpm-workspace.yaml` with strict catalog mode. Vite is used directly by the `examples/basic` app through a minimal React plugin configuration, while `packages/react` uses Vitest with `happy-dom` for tests. The package build path uses `tsdown`, which is already Rolldown-oriented and separate from the example app's Vite build.

The repository already requires Node `>=24 <25` and pnpm `>=11 <12`, satisfying Vite 8's Node baseline. Current Vite-specific code is intentionally small: there are no custom Rollup options, no `optimizeDeps.esbuildOptions`, no `build.commonjsOptions`, and no `import.meta.env` usage discovered during exploration.

## Goals / Non-Goals

**Goals:**

- Move the workspace Vite dependency baseline to Vite 8.
- Keep React Vite plugin and Vitest dependencies compatible with Vite 8.
- Preserve pnpm v11 strict catalog and release-age behavior.
- Leave build-script approval decisions to a human via `pnpm approve-builds` if the dependency refresh requires it.
- Validate that tests, package builds, and the basic Vite example continue to work.

**Non-Goals:**

- Changing the public API of `@soundor/react`.
- Reworking the example app architecture or adding new Vite features.
- Replacing Vitest, `happy-dom`, Turbo, or `tsdown`.
- Automatically approving dependency build scripts.

## Decisions

### Upgrade through workspace catalog entries

The implementation will update Vite-related catalog entries in `pnpm-workspace.yaml` instead of per-package dependency declarations.

Rationale: packages already consume Vite, Vitest, and `@vitejs/plugin-react` through `catalog:`, and `catalogMode: strict` makes the catalog the intended source of truth.

Alternative considered: update individual package manifests. This would fight the workspace's dependency model and increase drift risk.

### Treat `@vitejs/plugin-react` as an alignment dependency

The implementation should upgrade `@vitejs/plugin-react` to the Vite 8-era major if available outside the configured release-age window. If the latest plugin version is not installable due to `minimumReleaseAge`, the implementation should use the newest eligible Vite 8-compatible version or document the blocker.

Rationale: plugin v5 advertises Vite 8 compatibility, but plugin v6 aligns with the Vite 8/Oxc direction and reduces follow-up churn.

Alternative considered: upgrade only `vite`. This is acceptable as a fallback if plugin release age or compatibility blocks the migration.

### Keep Vitest on a Vite 8-compatible line

Vitest is already on `^4.1.6`, which supports Vite 8. The implementation may refresh to the newest eligible compatible patch/minor but does not need a major Vitest migration.

Rationale: minimizing test runner churn keeps the migration focused on Vite while preserving compatibility.

Alternative considered: pin all Vite-adjacent packages to their latest versions. This may be blocked by release-age policy and is not necessary for the Vite 8 migration goal.

### Manual build approvals remain manual

If pnpm detects new or changed dependency build scripts after lockfile regeneration, the implementer will stop and ask a human to run or review `pnpm approve-builds` rather than auto-approving.

Rationale: build-script approval is a supply-chain trust decision and the user explicitly requested manual approval.

Alternative considered: automatically run approval or write approval state. This is excluded to preserve human review.

## Risks / Trade-offs

- Vite 8's Rolldown/Oxc pipeline may expose bundling differences in the example app → Mitigate by running the example Vite build separately from the workspace build.
- Plugin ecosystem versions may be constrained by `minimumReleaseAge: 2880` → Mitigate by using the newest eligible compatible versions and documenting any blocked latest release.
- `allowBuilds.esbuild` may become stale if esbuild leaves the dependency graph → Mitigate by inspecting post-install dependency state and cleaning only if clearly unused.
- Upgrading the React plugin at the same time increases migration surface slightly → Mitigate by keeping config unchanged and falling back to plugin v5 if v6 is blocked.

## Migration Plan

1. Update Vite-related catalog entries for Vite 8 compatibility.
2. Regenerate the pnpm lockfile using the workspace package manager.
3. If pnpm reports dependency build approvals, pause for manual approval before proceeding.
4. Run install and validation commands for tests, workspace build, and the basic example Vite build.
5. Inspect whether `allowBuilds.esbuild` is still necessary after dependency resolution.

Rollback is straightforward: restore the previous catalog entries and lockfile state from version control.

## Open Questions

- Which exact Vite 8 and React plugin versions are eligible under the two-day release cooldown at implementation time?
- Will the refreshed dependency graph still require `allowBuilds.esbuild`?
