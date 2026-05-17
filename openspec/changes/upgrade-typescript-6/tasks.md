## 1. Baseline and Environment

- [ ] 1.1 Ensure dependencies are installed cleanly with the repo-supported Node and pnpm versions.
- [ ] 1.2 Run the current TypeScript 5.9 baseline validation: workspace build, tests, lint check, and format check.
- [ ] 1.3 Run targeted pre-upgrade checks for the basic example TypeScript configs and the React package TypeScript config.

## 2. TypeScript 6 Upgrade

- [ ] 2.1 Update the pnpm catalog TypeScript entry from 5.9.x to the selected TypeScript 6 release.
- [ ] 2.2 Regenerate the lockfile without broad unrelated dependency upgrades.
- [ ] 2.3 Confirm the installed workspace TypeScript compiler resolves to version 6.

## 3. Configuration Compatibility

- [ ] 3.1 Audit all workspace TypeScript configs for TS6 deprecated or removed options.
- [ ] 3.2 Verify TS6 default changes do not alter required behavior for `types`, `rootDir`, `target`, `module`, or `strict`.
- [ ] 3.3 Add or adjust explicit TypeScript config options only where validation shows ambiguity or changed behavior.
- [ ] 3.4 Avoid adding `ignoreDeprecations` unless a documented temporary upstream blocker requires it.

## 4. Build and Declaration Validation

- [ ] 4.1 Build `packages/react` with `tsdown --clean` under TypeScript 6.
- [ ] 4.2 Verify the React package emits `dist/index.js` and `dist/index.d.ts` matching its package exports.
- [ ] 4.3 Build `examples/basic` and verify `tsc -b` and Vite production build both succeed.

## 5. Workspace Validation

- [ ] 5.1 Run the React package Vitest test suite under TypeScript 6.
- [ ] 5.2 Run workspace lint and format checks.
- [ ] 5.3 Run the full workspace build and test commands.
- [ ] 5.4 If practical, perform a diagnostic dependency typing pass to surface issues hidden by `skipLibCheck` and document any findings.

## 6. Review and Cleanup

- [ ] 6.1 Remove or document any temporary compatibility workaround introduced during the upgrade.
- [ ] 6.2 Review the final diff to ensure only TypeScript 6 upgrade-related files changed.
- [ ] 6.3 Confirm the OpenSpec requirements are satisfied by the completed validation results.
