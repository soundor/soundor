## 1. Dependency Update

- [x] 1.1 Update the workspace catalog Vite entry from Vite 7 to a Vite 8-compatible range.
- [x] 1.2 Update `@vitejs/plugin-react` to the Vite 8-era major when eligible under `minimumReleaseAge`, or keep the newest eligible Vite 8-compatible version and document any blocker.
- [x] 1.3 Confirm Vitest remains on a Vite 8-compatible version and refresh only if needed.
- [x] 1.4 Regenerate `pnpm-lock.yaml` with pnpm v11 using the workspace catalog.

## 2. Manual Build Approval Check

- [x] 2.1 Inspect install output for dependency build-script approval prompts or changes.
- [x] 2.2 If build approvals are required, pause for a human to review/run `pnpm approve-builds` and record the resulting approved build state.
- [x] 2.3 Verify build approvals were not auto-granted by implementation automation.

## 3. Compatibility Review

- [x] 3.1 Verify `examples/basic/vite.config.ts` remains minimal and does not require Vite 8-specific config changes.
- [x] 3.2 Inspect the resolved dependency graph to determine whether `allowBuilds.esbuild` is still necessary.
- [x] 3.3 Remove stale `allowBuilds.esbuild` only if esbuild is no longer present and no approved build state depends on it.

## 4. Validation

- [x] 4.1 Run dependency installation with the updated lockfile.
- [x] 4.2 Run the workspace test command.
- [x] 4.3 Run the workspace build command.
- [x] 4.4 Run the basic example build command to validate `tsc -b && vite build`.
- [x] 4.5 Review changed dependency metadata and validation output for unexpected public API or app behavior changes.
