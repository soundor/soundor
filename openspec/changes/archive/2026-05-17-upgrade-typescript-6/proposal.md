## Why

TypeScript 6 introduces new compiler defaults, deprecations, and ecosystem expectations that affect workspace type-checking, declaration generation, and build tooling. Upgrading now keeps the repository current while the codebase is small and already aligned with modern TypeScript patterns such as bundler resolution, strict mode, and ESM.

## What Changes

- Upgrade the workspace TypeScript catalog dependency from 5.9.x to 6.x.
- Validate and adjust TypeScript configuration for TS6 defaults, especially explicit ambient `types`, declaration output assumptions, and deprecated options.
- Verify the React package build continues to emit JavaScript and declarations through `tsdown`.
- Verify the basic Vite example continues to type-check and build with TS6.
- Verify tests, linting, and formatting still pass after the compiler upgrade.
- Document or resolve any TS6 deprecation warnings rather than masking them long-term.

## Capabilities

### New Capabilities

- `typescript-6-tooling`: Workspace support for building, type-checking, testing, and validating the project with TypeScript 6.

### Modified Capabilities

## Impact

- Affected dependency catalog and lockfile entries: `typescript` in `pnpm-workspace.yaml` and `pnpm-lock.yaml`.
- Affected TypeScript configs: `configs/typescript-config/react-library.json`, `examples/basic/tsconfig.app.json`, and `examples/basic/tsconfig.node.json`.
- Affected build surfaces: `packages/react` via `tsdown --clean` and `examples/basic` via `tsc -b && vite build`.
- Affected validation surfaces: Vitest tests, oxlint, oxfmt, and Turborepo task execution.
- No intended public API change for `@soundor/react`.
