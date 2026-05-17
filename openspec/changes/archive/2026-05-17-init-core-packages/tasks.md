## 1. @soundor/config package

- [x] 1.1 Create `packages/config/` with `package.json` (`@soundor/config`, ESM, Node 24+, exports `./src/index.ts`)
- [x] 1.2 Add `tsconfig.json` extending `@soundor/typescript-config`
- [x] 1.3 Add `tsdown.config.ts` using the `node` preset with `dts: true`
- [x] 1.4 Implement `src/types.ts` exporting `Parameter` and `ProjectConfig` interfaces
- [x] 1.5 Implement `src/parse.ts` exporting stub `parseConfig(path: string): Promise<ProjectConfig>`
- [x] 1.6 Implement `src/index.ts` re-exporting all public types and utilities
- [x] 1.7 Add `test/config.test.ts` with vitest tests for `parseConfig` and type exports
- [x] 1.8 Verify `pnpm build` and `pnpm test` pass in `packages/config/`

## 2. @soundor/runtime-sdk package

- [x] 2.1 Create `packages/runtime-sdk/` with `package.json` (`@soundor/runtime-sdk`, ESM, Node 24+, depends on `@soundor/config`)
- [x] 2.2 Add `tsconfig.json` extending `@soundor/typescript-config`
- [x] 2.3 Add `tsdown.config.ts` using the `node` preset with `dts: true`
- [x] 2.4 Implement `src/types.ts` exporting `Runtime` interface and `BuildOptions` type
- [x] 2.5 Implement `src/errors.ts` exporting `SoundorError` class
- [x] 2.6 Implement `src/index.ts` re-exporting all public types and utilities
- [x] 2.7 Add `test/runtime-sdk.test.ts` with vitest tests for `SoundorError` and type shapes
- [x] 2.8 Verify `pnpm build` and `pnpm test` pass in `packages/runtime-sdk/`

## 3. @soundor/cli package

- [x] 3.1 Add `citty` and `@clack/prompts` to the workspace catalog in `pnpm-workspace.yaml`
- [x] 3.2 Create `packages/cli/` with `package.json` (`@soundor/cli`, ESM, `engines: { node: ">=22" }`, `bin: { soundor: ./dist/index.js }`, depends on `@soundor/config`, `@soundor/runtime-sdk`, `citty`, and `@clack/prompts`)
- [x] 3.3 Add `tsconfig.json` extending `@soundor/typescript-config`
- [x] 3.4 Add `tsdown.config.ts` using the `node` preset, `dts: false`, and `banner: { js: '#!/usr/bin/env node' }`
- [x] 3.5 Implement `src/commands/init.ts` — stub command, exits 0
- [x] 3.6 Implement `src/commands/gen.ts` — stub command, exits 0
- [x] 3.7 Implement `src/commands/dev.ts` — requires `runtime` arg, exits non-zero if missing
- [x] 3.8 Implement `src/commands/build.ts` — optional `runtime` arg, exits 0
- [x] 3.9 Implement `src/commands/doctor.ts` — stub command, exits 0
- [x] 3.10 Implement `src/index.ts` — citty entry point wiring all five commands
- [x] 3.11 Add `test/commands/init.test.ts`, `gen.test.ts`, `dev.test.ts`, `build.test.ts`, `doctor.test.ts` with vitest unit tests
- [x] 3.12 Verify `pnpm build` and `pnpm test` pass in `packages/cli/`
- [x] 3.13 Verify the built binary runs: `node packages/cli/dist/index.js --help`
