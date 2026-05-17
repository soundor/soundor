## Context

The soundor monorepo currently has one package (`@soundor/react`) and two shared configs (`@soundor/tsdown-config`, `@soundor/typescript-config`). The toolchain is in place (tsdown, vitest, turbo, oxlint, oxfmt) but no core domain packages exist yet.

Three packages need to be bootstrapped in dependency order:

1. `@soundor/config` — no soundor deps
2. `@soundor/runtime-sdk` — depends on `@soundor/config`
3. `@soundor/cli` — depends on both

This is a stub pass. The goal is correct structure, not complete implementation.

## Goals / Non-Goals

**Goals:**

- Each package has a working `package.json`, `tsdown.config.ts`, and `tsconfig.json`
- Each package exports its public surface (even if stubs)
- Each package builds (`pnpm build`) and tests (`pnpm test`) successfully
- `@soundor/cli` produces a `soundor` binary with all five commands routing correctly
- Vitest is wired in each package with at least one test per command/export

**Non-Goals:**

- Real config file parsing (stub only)
- Real filesystem operations in `init` or `gen`
- Runtime loading / dynamic import of runtime packages
- Binary distribution or npm publish setup

## Decisions

### ESM-only, Node 22+ (published), Node 24 (dev)

No CJS output. `"type": "module"` in all `package.json` files. tsdown `format: ['esm']` via the existing `node` preset.

Two distinct constraints:

- **Published engines** (`@soundor/cli` package.json): `"node": ">=22"` — users on Node 22 or 24 can install and run the CLI
- **Development environment** (monorepo root): `"node": ">=24 <25"` — contributors run Node 24

Implications:

- `import.meta.dirname` is safe — available since Node 21.2+
- `util.parseArgs` is safe — stable since Node 18.3+
- Do NOT use `--experimental-strip-types` as a dev script — it behaves differently on Node 22 vs 24; use tsdown watch instead
- No Node 24-only APIs in CLI source code

### CLI framework: citty + @clack/prompts

Two libraries with non-overlapping responsibilities:

- **citty** — routing, argument parsing, help text generation. Five flat commands with one optional argument (`runtime`). UnJS ecosystem (same family as rolldown/tsdown), minimal, no magic. Alternative considered: raw `process.argv` — viable but requires writing help text and error formatting by hand.
- **@clack/prompts** — interactive prompts (text, select, confirm) and spinners for human-facing flows. Used inside command handlers, never in the routing layer. Auto-detects non-TTY (CI, pipes) and cancels gracefully.

All prompt calls MUST be followed by `isCancel()` checks — if the user hits Ctrl+C or the CLI runs in a non-TTY environment, the command exits cleanly with code 0.

Commands that use prompts MUST also accept equivalent CLI flags so they are fully scriptable without interaction (e.g. `soundor init --name my-plugin --runtime juce`).

### `dts: false` for `@soundor/cli`

The CLI is a binary, not a library. No consumers import it. Generating `.d.ts` files is waste. `@soundor/config` and `@soundor/runtime-sdk` keep `dts: true` since they are imported by other packages.

### Shebang via tsdown banner

```ts
banner: {
  js: '#!/usr/bin/env node';
}
```

Applied only in `@soundor/cli`'s tsdown config. The output `dist/index.js` gets the shebang on line 1.

### Package `bin` field

```json
"bin": { "soundor": "./dist/index.js" }
```

Standard npm binary registration. No wrapper script needed.

### Dependency direction

```
@soundor/config
    ↑
@soundor/runtime-sdk
    ↑
@soundor/cli
```

`@soundor/config` has zero soundor deps. `@soundor/runtime-sdk` imports config types only. `@soundor/cli` imports both. No cycles.

### Test strategy

Each command function takes explicit arguments (no global state, no `process.argv` reading inside commands). This makes unit testing straightforward — pass args, assert behavior or thrown errors. vitest with happy-dom not needed (Node-only).

## Risks / Trade-offs

- **citty is young** → If it proves insufficient, the routing layer is small enough to replace without touching command implementations
- **@clack/prompts in non-TTY** → All prompt calls require `isCancel()` guards; skipping one silently hangs or crashes in CI
- **Stubs pass tests trivially** → Tests will need to evolve as real implementations land; they establish the contract now, not the behavior
- **Node 22 vs 24 API surface** → Audit any new Node built-in used in CLI source against Node 22 compatibility; the monorepo running Node 24 won't catch this automatically

## Open Questions

- Should `@soundor/runtime-sdk` export a `defineRuntime()` helper (like `defineConfig()` in vite) to give runtimes a typed entry point? Deferred — stub pass only.
- Error exit codes: define an enum now or defer? Defer — stub `SoundorError` with a message is enough for now.
