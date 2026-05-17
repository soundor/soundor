## Why

Vite 8 is the latest major Vite release and moves the ecosystem toward Rolldown/Oxc-based builds. Updating now keeps the example app and test tooling aligned with current Vite support while the repository's Vite usage is still simple and low-risk.

## What Changes

- Upgrade the workspace Vite catalog entry from Vite 7 to Vite 8.
- Align Vite-adjacent tooling with Vite 8 compatibility, including the React Vite plugin where appropriate.
- Regenerate the pnpm lockfile using the existing pnpm v11 workflow and strict catalog configuration.
- Keep dependency build approvals as a manual implementation step; do not auto-approve build scripts.
- Verify the Vite example app, Vitest test suite, and workspace build continue to pass.

## Capabilities

### New Capabilities

- `vite-8-tooling`: Covers the workspace's Vite 8 dependency baseline, compatible React/Vitest tooling, manual build approvals, and validation expectations.

### Modified Capabilities

- `dependency-supply-chain-hardening`: Clarifies that build-script approval remains a manual human step during the Vite 8 dependency refresh.

## Impact

- Affected dependency metadata: `pnpm-workspace.yaml` catalog entries and `pnpm-lock.yaml` resolution state.
- Affected packages: `examples/basic` Vite app and `packages/react` Vitest setup through shared catalog dependencies.
- Affected validation: workspace install, tests, package build, and example Vite build.
- No expected public API changes for `@soundor/react`.
