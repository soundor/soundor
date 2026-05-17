## Why

The project should upgrade to pnpm v11 to adopt newer supply-chain protections and stay current with the package manager used by local development and CI. This is timely because pnpm v11 introduces stronger defaults around dependency build scripts, exotic subdependencies, dependency verification, and package release-age gating.

## What Changes

- Upgrade the workspace package manager from pnpm 10 to pnpm 11.
- Configure a two-day package release cooldown via `minimumReleaseAge: 2880` to reduce exposure to newly published compromised packages.
- Migrate removed pnpm v10 build-script configuration away from `ignoredBuiltDependencies`.
- Require build-script approvals to be reviewed manually with `pnpm approve-builds` during implementation instead of mechanically preserving the previous `esbuild` rejection.
- Regenerate the pnpm lockfile with pnpm v11 and verify install/build/test workflows.

## Capabilities

### New Capabilities

- `dependency-supply-chain-hardening`: Workspace dependency installation SHALL use pnpm v11 supply-chain controls, including release-age cooldown and explicit dependency build-script approval.

### Modified Capabilities

## Impact

- Affects root package manager metadata in `package.json`.
- Affects pnpm workspace configuration in `pnpm-workspace.yaml`.
- Affects `pnpm-lock.yaml` after regeneration with pnpm v11.
- Affects CI dependency installation through the existing Corepack-based setup action.
- May affect packages with dependency build scripts depending on the manual `pnpm approve-builds` decisions.
