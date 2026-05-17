## 1. Package Setup

- [ ] 1.1 Create `packages/create-soundor-app/` directory with `package.json` (bin: `create-soundor-app`, not private, version `0.1.0`)
- [ ] 1.2 Add `tsconfig.json` extending `@soundor/typescript-config`
- [ ] 1.3 Add `tsdown` build config extending `@soundor/tsdown-config`
- [ ] 1.4 Add dependencies: `@clack/prompts`, `citty`
- [ ] 1.5 Add devDependencies: `@soundor/tsdown-config`, `@soundor/typescript-config`, `@types/node`, `tsdown`, `vitest`
- [ ] 1.6 Add `"files": ["dist", "templates"]` to `package.json`

## 2. Template Files

- [ ] 2.1 Create `templates/base/package.json` based on `examples/basic/package.json` with `__PROJECT_NAME__` token for name, `@soundor/cli` added as a dependency
- [ ] 2.2 Create `templates/base/vite.config.ts` (copy from `examples/basic/vite.config.ts`)
- [ ] 2.3 Create `templates/base/tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json` (copy from `examples/basic`)
- [ ] 2.4 Create `templates/base/index.html` (copy from `examples/basic/index.html`)
- [ ] 2.5 Create `templates/base/src/main.tsx` (copy from `examples/basic/src/main.tsx`)
- [ ] 2.6 Create `templates/base/src/App.tsx` (copy from `examples/basic/src/App.tsx`)
- [ ] 2.7 Create `templates/base/soundor.config.ts` with `__PROJECT_NAME__` and `__RUNTIME__` tokens
- [ ] 2.8 Create `templates/base/_gitignore` (standard Node/Vite gitignore)

## 3. Core CLI Implementation

- [ ] 3.1 Create `src/index.ts` — main entry point using `citty` `defineCommand` with optional positional `name` arg
- [ ] 3.2 Implement package manager detection via `npm_config_user_agent` env var; fall back to prompt if undetectable
- [ ] 3.3 Implement `@clack/prompts` interactive flow: project name → runtime select → package manager select from [pnpm, yarn, npm, bun] (with cancel handling at each step)
- [ ] 3.4 Implement scaffold function: resolve template dir via `import.meta.url`, `fs.cp` to destination, abort if target directory already exists
- [ ] 3.5 Implement token replacement: JSON parse/stringify for `package.json`, regex replace for `soundor.config.ts`
- [ ] 3.6 Implement `_gitignore` → `.gitignore` rename
- [ ] 3.7 Implement dependency installation: spawn `<pm> install` in project directory, stream output
- [ ] 3.8 Implement `soundor init <runtime>` delegation: spawn via `<pm> exec soundor init <runtime>` in project directory
- [ ] 3.9 Implement success output: display `cd <name>` and `<pm> dev` next steps via `@clack/prompts` outro

## 4. Build & Workspace Integration

- [ ] 4.1 Add `create-soundor-app` to turbo pipeline if needed (verify `turbo.json` picks it up via workspace glob)
- [ ] 4.2 Run `pnpm install` from repo root to link the new workspace package
- [ ] 4.3 Run `pnpm build` for `create-soundor-app` and verify `dist/` and `templates/` are both present in output
