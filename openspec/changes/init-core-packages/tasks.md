## 1. @soundor/config package

- [ ] 1.1 Create `packages/config/` with `package.json` (`@soundor/config`, ESM, Node 24+, exports `./src/index.ts`)
- [ ] 1.2 Add `tsconfig.json` extending `@soundor/typescript-config`
- [ ] 1.3 Add `tsdown.config.ts` using the `node` preset with `dts: true`
- [ ] 1.4 Implement `src/types.ts` exporting `Parameter` and `ProjectConfig` interfaces
- [ ] 1.5 Implement `src/parse.ts` exporting stub `parseConfig(path: string): Promise<ProjectConfig>`
- [ ] 1.6 Implement `src/index.ts` re-exporting all public types and utilities
- [ ] 1.7 Add `test/config.test.ts` with vitest tests for `parseConfig` and type exports
- [ ] 1.8 Verify `pnpm build` and `pnpm test` pass in `packages/config/`

## 2. @soundor/runtime-sdk package

- [ ] 2.1 Create `packages/runtime-sdk/` with `package.json` (`@soundor/runtime-sdk`, ESM, Node 24+, depends on `@soundor/config`)
- [ ] 2.2 Add `tsconfig.json` extending `@soundor/typescript-config`
- [ ] 2.3 Add `tsdown.config.ts` using the `node` preset with `dts: true`
- [ ] 2.4 Implement `src/types.ts` exporting `Runtime` interface and `BuildOptions` type
- [ ] 2.5 Implement `src/errors.ts` exporting `SoundorError` class
- [ ] 2.6 Implement `src/index.ts` re-exporting all public types and utilities
- [ ] 2.7 Add `test/runtime-sdk.test.ts` with vitest tests for `SoundorError` and type shapes
- [ ] 2.8 Verify `pnpm build` and `pnpm test` pass in `packages/runtime-sdk/`

## 3. @soundor/cli package

- [ ] 3.1 Add `citty` and `@clack/prompts` to the workspace catalog in `pnpm-workspace.yaml`
- [ ] 3.2 Create `packages/cli/` with `package.json` (`@soundor/cli`, ESM, `engines: { node: ">=22" }`, `bin: { soundor: ./dist/index.js }`, depends on `@soundor/config`, `@soundor/runtime-sdk`, `citty`, and `@clack/prompts`)
- [ ] 3.3 Add `tsconfig.json` extending `@soundor/typescript-config`
- [ ] 3.4 Add `tsdown.config.ts` using the `node` preset, `dts: false`, and `banner: { js: '#!/usr/bin/env node' }`
- [ ] 3.5 Implement `src/commands/init.ts` — stub command, exits 0
- [ ] 3.6 Implement `src/commands/gen.ts` — stub command, exits 0
- [ ] 3.7 Implement `src/commands/dev.ts` — requires `runtime` arg, exits non-zero if missing
- [ ] 3.8 Implement `src/commands/build.ts` — optional `runtime` arg, exits 0
- [ ] 3.9 Implement `src/commands/doctor.ts` — stub command, exits 0
- [ ] 3.10 Implement `src/index.ts` — citty entry point wiring all five commands
- [ ] 3.11 Add `test/commands/init.test.ts`, `gen.test.ts`, `dev.test.ts`, `build.test.ts`, `doctor.test.ts` with vitest unit tests
- [ ] 3.12 Verify `pnpm build` and `pnpm test` pass in `packages/cli/`
- [ ] 3.13 Verify the built binary runs: `node packages/cli/dist/index.js --help`
