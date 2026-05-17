## Why

Developers have no fast way to bootstrap a new Soundor project from scratch. `create-soundor-app` fills this gap — a standalone CLI that scaffolds a complete project, installs dependencies, and wires up the chosen runtime via `soundor init`, mirroring the developer experience of `create-vite` and `create-next-app`.

## What Changes

- **New package** `create-soundor-app` added to `packages/` with its own binary entry point
- Standalone CLI invocable via `npx create-soundor-app [name]`
- Interactive prompts: project name, runtime selection (single), package manager
- Bundled `templates/base/` directory (create-vite style — static files, no template engine)
- Token replacement for `package.json` (project name) and `soundor.config.ts` (project name + runtime)
- Installs dependencies then delegates to `soundor init <runtime>` to finalize runtime setup
- Runtime list hardcoded for now (starting with `juce`), designed to be replaced by registry lookup later

## Capabilities

### New Capabilities

- `create-soundor-app`: Interactive CLI that scaffolds a new Soundor project from scratch — prompts, template copying, dependency installation, and `soundor init` delegation

### Modified Capabilities

## Impact

- New `packages/create-soundor-app/` workspace package
- `pnpm-workspace.yaml` picks it up automatically via `packages/*` glob
- No changes to existing packages (`@soundor/cli`, `@soundor/react`, etc.)
- `@soundor/cli` becomes a runtime dependency of the scaffolded project (not of `create-soundor-app` itself)
- Adds `execa` (or child_process) dependency for spawning `pnpm install` and `soundor init`
