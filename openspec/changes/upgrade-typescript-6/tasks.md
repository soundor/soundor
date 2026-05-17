## 1. Baseline and Environment

- [x] 1.1 Ensure dependencies are installed cleanly with the repo-supported Node and pnpm versions.
- [x] 1.2 Run the current TypeScript 5.9 baseline validation: workspace build, tests, lint check, and format check.
- [x] 1.3 Run targeted pre-upgrade checks for the basic example TypeScript configs and the React package TypeScript config.

## 2. TypeScript 6 Upgrade

- [x] 2.1 Update the pnpm catalog TypeScript entry from 5.9.x to the selected TypeScript 6 release.
- [x] 2.2 Regenerate the lockfile without broad unrelated dependency upgrades.
- [x] 2.3 Confirm the installed workspace TypeScript compiler resolves to version 6.

## 3. Configuration Compatibility

- [x] 3.1 Audit all workspace TypeScript configs for TS6 deprecated or removed options.
- [x] 3.2 Verify TS6 default changes do not alter required behavior for `types`, `rootDir`, `target`, `module`, or `strict`.
- [x] 3.3 Add or adjust explicit TypeScript config options only where validation shows ambiguity or changed behavior.
- [x] 3.4 Avoid adding `ignoreDeprecations` unless a documented temporary upstream blocker requires it.

## 4. Build and Declaration Validation

- [x] 4.1 Build `packages/react` with `tsdown --clean` under TypeScript 6.
- [x] 4.2 Verify the React package emits `dist/index.js` and `dist/index.d.ts` matching its package exports.
- [x] 4.3 Build `examples/basic` and verify `tsc -b` and Vite production build both succeed.

## 5. Workspace Validation

- [x] 5.1 Run the React package Vitest test suite under TypeScript 6.
- [x] 5.2 Run workspace lint and format checks.
- [x] 5.3 Run the full workspace build and test commands.
- [x] 5.4 If practical, perform a diagnostic dependency typing pass to surface issues hidden by `skipLibCheck` and document any findings.

## 6. Review and Cleanup

- [x] 6.1 Remove or document any temporary compatibility workaround introduced during the upgrade.
- [x] 6.2 Review the final diff to ensure only TypeScript 6 upgrade-related files changed.
- [x] 6.3 Confirm the OpenSpec requirements are satisfied by the completed validation results.
