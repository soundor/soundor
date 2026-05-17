## Context

The workspace currently pins `pnpm@10.26.2` in root `package.json` and uses Corepack in CI to install that pinned package manager before running `pnpm install --frozen-lockfile`. The repo already requires Node 24, so pnpm v11's Node 22+ requirement is satisfied.

Workspace pnpm configuration currently lives in `pnpm-workspace.yaml`, including strict catalogs and `ignoredBuiltDependencies: [esbuild]`. pnpm v11 removes several older build-script configuration fields, including `ignoredBuiltDependencies`, and consolidates build approvals into `allowBuilds`.

## Goals / Non-Goals

**Goals:**
- Upgrade the workspace to pnpm v11 using the root `packageManager` field and a regenerated lockfile.
- Configure a two-day release-age cooldown with `minimumReleaseAge: 2880`.
- Remove pnpm v10-only build-script configuration.
- Preserve the existing CI setup model: Corepack installs the package manager defined by the repo, then CI runs frozen-lockfile install and existing checks.
- Make dependency build-script trust an explicit manual review step using `pnpm approve-builds`.

**Non-Goals:**
- Do not introduce a new package manager or change workspace layout.
- Do not change dependency versions beyond what is required by pnpm v11 lockfile regeneration.
- Do not configure Rolldown or other bundler changes as part of this change.
- Do not automatically approve or reject dependency build scripts in the proposal; approvals are intentionally manual during implementation.

## Decisions

### Use pnpm v11 via `packageManager`

Pin pnpm v11 in the existing root `packageManager` field so local Corepack and CI Corepack follow the same package-manager version source of truth.

Alternative considered: install pnpm globally in CI. This would split local and CI behavior and weaken reproducibility, so the existing Corepack approach remains preferable.

### Configure cooldown in `pnpm-workspace.yaml`

Set `minimumReleaseAge: 2880` in `pnpm-workspace.yaml`. pnpm v11 defaults to one day; this change intentionally requires two days before newly published package versions are eligible for installation.

Alternative considered: rely on pnpm v11's default one-day cooldown. The project explicitly wants a stricter two-day window for supply-chain risk reduction.

### Remove `ignoredBuiltDependencies` and use manual approval

Do not mechanically convert the current `ignoredBuiltDependencies: [esbuild]` entry to `allowBuilds: { esbuild: false }`. Instead, remove the old field and run `pnpm approve-builds` manually during implementation so the current set of dependency build scripts is reviewed explicitly under pnpm v11.

Alternative considered: preserve prior behavior with `allowBuilds: esbuild: false`. That is mechanically safe, but it skips the desired trust review and may miss other packages requiring explicit allow/reject decisions.

### Keep install verification centered on frozen lockfile behavior

After regenerating `pnpm-lock.yaml`, verify that `pnpm install --frozen-lockfile` succeeds. This mirrors CI's dependency install behavior and confirms the committed lockfile/configuration is self-consistent.

## Risks / Trade-offs

- Release-age cooldown may block legitimate very new dependency releases → Mitigation: implementation can defer upgrades until packages age past two days, or use a narrowly scoped exception only if absolutely necessary.
- Manual `pnpm approve-builds` requires human judgment and may produce different results depending on environment state → Mitigation: record the generated `allowBuilds` decisions in `pnpm-workspace.yaml` and review them in code review.
- Lockfile regeneration may include broader metadata changes than expected → Mitigation: inspect the lockfile diff and avoid intentional dependency upgrades unless required.
- CI may expose Corepack or pnpm v11 behavior differences → Mitigation: run the same install/build/test commands locally before relying on CI.
