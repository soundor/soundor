## Context

The Soundor monorepo has an existing `@soundor/cli` package (the `soundor` binary) with subcommands like `init`, `dev`, `build`, etc. `create-soundor-app` is a separate, standalone CLI — a one-shot bootstrapper that users run once via `npx` to create a new project. It is not a subcommand of `soundor`; it is its own published package.

The `examples/basic` project represents the ideal output of `create-soundor-app` and serves as the canonical reference for the bundled template.

## Goals / Non-Goals

**Goals:**

- Bootstrap a complete, runnable Soundor project in a single command
- Bundle templates inside the package (offline-friendly, create-vite style)
- Delegate runtime wiring to `soundor init <runtime>` after scaffolding
- Single runtime selection at creation time
- Detect or prompt for package manager (pnpm/npm/yarn/bun)

**Non-Goals:**

- Multiple runtime selection at creation time (edge case handled later via `soundor init`)
- Fetching templates from a remote registry or GitHub
- Modifying the existing `@soundor/cli` package
- Supporting Node < 22

## Decisions

### 1. Separate package, not a `soundor` subcommand

`create-soundor-app` is invoked via `npx create-soundor-app` before any Soundor dependencies exist in the target project. Embedding it inside `@soundor/cli` would require users to install the CLI globally first, defeating the zero-install ergonomics of `npx`. A standalone package also matches the ecosystem convention (create-vite, create-next-app).

### 2. Bundled templates (create-vite style)

Templates live in `templates/base/` inside the package, included in the npm `files` field. At runtime, the CLI resolves the template directory via `import.meta.url` and copies files with Node's `fs.cp`. No network required.

Alternatives considered:

- **Remote fetch (create-next-app style)**: More flexible for adding templates without releasing the CLI, but requires internet and adds latency.
- **Embedded string literals**: Self-contained bundle but templates become invisible to diffs and hard to maintain.

### 3. Token replacement via simple string replace (no template engine)

Only two files need parameterization:

- `package.json` — project name (JSON parse → mutate → stringify)
- `soundor.config.ts` — project name + runtime (regex string replace on `__PROJECT_NAME__` and `__RUNTIME__` tokens)

Handlebars/EJS would be overkill and add a dependency.

### 4. `.gitignore` rename trick

npm strips dotfiles from published packages. The template's `.gitignore` is stored as `_gitignore` and renamed to `.gitignore` during the copy step (same as create-vite).

### 5. Package manager detection

Supported PMs: **pnpm, yarn, npm, bun** — matching the create-vite and create-next-app ecosystem standard.

Detect the PM used to invoke `create-soundor-app` via the `npm_config_user_agent` environment variable. Fall back to prompting if undetectable. The selected PM is used for both `install` and spawning `soundor init`.

### 6. Hardcoded runtime list

Runtime choices are a hardcoded array for now (`['juce']`). The selection UI uses `@clack/prompts` select (single choice). The array shape makes it straightforward to replace with a registry fetch later without changing the prompt logic.

### 7. `soundor init` delegation via subprocess

After `pnpm install` (or equivalent) completes, spawn `soundor init <runtime>` as a child process in the new project directory. This keeps runtime-specific logic inside `@soundor/cli` where it belongs and avoids duplicating or importing it.

## Risks / Trade-offs

- **`soundor init` is currently a stub** — it only prints a spinner. `create-soundor-app` will call it correctly, but the actual runtime wiring won't do anything meaningful until `soundor init` is implemented for real. This is acceptable; the integration point is established.
- **Template drift** — the bundled template must stay in sync with `examples/basic`. Risk: they diverge over time. Mitigation: treat `examples/basic` as the source of truth; keep the template a near-copy.
- **Package manager detection edge cases** — `npm_config_user_agent` may be absent in unusual environments. Mitigation: prompt fallback.

## Open Questions

- Should `create-soundor-app` itself be published publicly (not `private: true`)? Yes — it needs to be on npm for `npx` to work.
- What version to publish at? `0.1.0` on initial release, matching the project's pre-1.0 stance.
