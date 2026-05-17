## 1. pnpm v11 Upgrade

- [ ] 1.1 Update root `package.json` `packageManager` to the latest pnpm v11 release supported by Corepack.
- [ ] 1.2 Use Corepack/pnpm v11 to regenerate `pnpm-lock.yaml` without intentionally upgrading catalog dependency versions.
- [ ] 1.3 Confirm the repo's Node 24 configuration remains compatible with pnpm v11.

## 2. Supply-Chain Configuration

- [ ] 2.1 Add `minimumReleaseAge: 2880` to `pnpm-workspace.yaml`.
- [ ] 2.2 Remove the removed pnpm v10 `ignoredBuiltDependencies` field from `pnpm-workspace.yaml`.
- [ ] 2.3 Run `pnpm approve-builds` manually and record the generated `allowBuilds` decisions in `pnpm-workspace.yaml`.
- [ ] 2.4 Review the resulting `allowBuilds` entries to ensure each approved build script is intentional.

## 3. Verification

- [ ] 3.1 Run `pnpm install --frozen-lockfile` to verify the committed lockfile and workspace configuration.
- [ ] 3.2 Run the existing lint workflow.
- [ ] 3.3 Run the existing build workflow.
- [ ] 3.4 Run the existing test workflow.
- [ ] 3.5 Inspect the final diff for unintended dependency upgrades or unrelated configuration changes.
