## Why

Soundor needs a minimal, working foundation of core packages before any runtime or user-facing tooling can be built. Without `@soundor/config`, `@soundor/runtime-sdk`, and `@soundor/cli` in place — even as stubs — nothing else in the monorepo has a stable surface to build against.

## What Changes

- Add `packages/config/` — new package `@soundor/config` providing the `soundor.config.ts` shape (types) and a minimal parse utility
- Add `packages/runtime-sdk/` — new package `@soundor/runtime-sdk` providing the `Runtime` interface and shared error/process utilities that both CLI and runtimes depend on
- Add `packages/cli/` — new package `@soundor/cli` providing the `soundor` binary with five stub commands: `init`, `gen`, `dev`, `build`, `doctor`
- All three packages use `tsdown` for building (ESM-only, Node 24+), `vitest` for testing, and share existing monorepo configs

## Capabilities

### New Capabilities

- `soundor-config`: The `soundor.config.ts` schema — `ProjectConfig`, `Parameter`, and related types — plus a `parseConfig(path)` utility that reads and validates a project's config file
- `runtime-sdk`: The `Runtime` interface contract that all runtimes must implement, plus shared utilities (typed `SoundorError`, exit codes) used by both the CLI and runtimes
- `soundor-cli`: The `soundor` CLI binary exposing five commands (`init`, `gen`, `dev`, `build`, `doctor`), each as a stub that delegates to the runtime or prints a not-yet-implemented message

### Modified Capabilities

## Impact

- New packages added to `pnpm-workspace.yaml` (already covered by `packages/*` glob)
- `@soundor/cli` depends on `@soundor/config` and `@soundor/runtime-sdk`
- `@soundor/runtime-sdk` depends on `@soundor/config`
- No existing packages modified
- Node 24+, ESM-only — no CJS output
