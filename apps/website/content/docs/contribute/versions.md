---
title: 'Controlling versions'
description: 'Package versions, the runtime API version and the docs @since annotations: who records what, and what the release resolves.'
---

## Purpose

Three kinds of versioning meet at a release, and none of them is a hand-edited
number in a PR:

- **Package versions** (`0.18.0`) say what npm has. Changesets decides them,
  from changesets PRs leave in `.changeset/`.
- **The runtime API version** (`RUNTIME_API_VERSION`) says what a runtime
  depends on of its host. PRs record a pending change; the release resolves
  the number, so published values are dense — one per contract-bearing
  release, however many PRs made it.
- **The docs' `@since` annotations** say when an API the docs show was
  introduced. PRs annotate with the placeholder `@since next`; the release
  writes the version over it.

Everything is materialized in one place: `pnpm run version`, which the
release pipeline runs to make the release pull request. What that script
leaves in the working tree is committed there, and the release PR gets the
repository's ordinary CI before anyone merges it.

## Package versions

A change to a published package adds a changeset (`pnpm changeset`). When the
release pipeline finds pending changesets, its Version step runs
`changeset version` — writing the next versions and changelogs — and then the
resolver, and opens or updates the release PR. Publishing runs later, from
the release PR's merge, against exactly that commit.

The seventeen packages under `packages/` are one fixed version group: any of
them bumping bumps all. `@soundor/engine`, `@soundor/yoga-wasm`,
`@soundor/juce-runtime`, `@soundor/web-runtime` and `@soundor/vst3-host` are
versioned on their own.

## The runtime API version

The record is `packages/config/runtime-api.json`:

```json
{
  "released": 2,
  "min": 1,
  "next": "raise",
  "declarations": { "…#Declaration": "hash" }
}
```

- `released` — the version the last published line of `@soundor/config`
  shipped (`1` is the version-less era: runtimes made before API versions
  implement it).
- `min` — the oldest version the next published host runs.
- `next` — the pending change: `null`, or `"raise"` for a compatible
  addition, or `"break"` when runtimes for older versions cannot run.
- `declarations` — a hash of each declaration of the contract, what the
  version describes (`src/__tests__/runtime-api.test.ts` checks them).

`packages/config/src/version.ts` shows the numbers a workspace runs with,
written from the record: `RUNTIME_API_VERSION` is `released + 1` while a
change is pending, `released` otherwise, and `MIN_RUNTIME_API_VERSION` is the
version when the pending change is a break, `min` otherwise. While the change
is pending, the workspace already runs as the version it will ship, so the
feature gates and the first-party runtimes are consistent from the PR on.

### Changing the contract

1. Make the change, and run the contract's test:

   ```sh
   pnpm --filter @soundor/config test
   ```

   A change to a recorded declaration fails it, naming what changed.

2. Decide whether runtimes can notice:

   - they cannot (a rename of a private type, a stricter check): record
     without a pending change — leave `next` as `null`;
   - a compatible addition: set `"next": "raise"`, keep `min`; a new config
     field is tagged in `CONFIG_FEATURES` with `since: NEXT_API_VERSION`;
   - a break: set `"next": "break"`. Older runtimes are refused, so `min`
     becomes the shipped version — the only safe line, since the host hands
     every runtime its context and there is no per-usage check for what a
     runtime depends on structurally.

3. Re-record and write the version numbers:

   ```sh
   UPDATE_RUNTIME_API=1 pnpm --filter @soundor/config test
   ```

   The command writes the new declaration hashes and `version.ts`'s two
   constants. Neither is edited by hand.

The first-party runtimes' tests check that they implement the version they
are built with; a runtime must be checked against a raise, and released with
it if it implements what the raise adds.

### What the release does

`scripts/resolve-release.mjs`, run by `pnpm run version` after
`changeset version`:

- a pending change ships as `released + 1` — one value per release line,
  whatever number of PRs recorded changes since the last release. The record
  advances (`released`, and `min` for a break), `version.ts` is written, and
  every `NEXT_API_VERSION` in `CONFIG_FEATURES` becomes the shipped number;
- it refuses to ship a pending change in the wrong release: a minor bump
  before 1.0, a major for a break from 1.0 on;
- it leaves the change pending when this release does not publish
  `@soundor/config` at all — the code and its marker always ship together,
  because a change merged after the release PR's last update is not in the
  release.

The script is idempotent: a resolved record has no pending change, and
materialized annotations are no longer placeholders, so a re-run — as the
release PR gets on every push to main — changes nothing.

## Docs `@since` annotations

Every declaration or interface member that the docs show — `@soundor/react`'s
source and the runtime-provided modules in `packages/environment` — carries
`@since` in its doc comment, which the generated props tables render. A PR
adding one annotates it `@since next`, the version of its own release, which
does not exist yet; at the release the resolver writes the package's new
version over every placeholder, from the nearest `package.json` (which
`changeset version` has already written).

The website shows a compact `Added in: v0.17.0` line, or `Added in: next
release` while the annotation is pending. Generated prop descriptions read
it from the member's `@since`, including inherited props. For a hook or API
page, put a source-backed marker below its heading in an `.mdx` file:

```mdx
<ApiAdded path="packages/react/src/hooks.ts" name="useStateHistory" />
```

The marker reads the declaration's annotation at build time; a missing
declaration or annotation fails the build. Both forms are included in the
page's Markdown export, so the version is available without the UI too.

The check is `scripts/check-since.mjs`, run by CI's Workspace job:

```sh
node scripts/check-since.mjs
```

It compares each file with the newest tag of the package that owns it, and
calls out what the tag's file does not have whose doc comment lacks `@since`.
The parse is plain text: what it does not recognize is silently unchecked,
never wrongly failed. Because the baseline is a tag, an annotation already
materialized counts — the check only ever demands `@since next` from what is
genuinely unreleased.

## Where things are

| Thing                                           | Where                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| The record (versions and contract)              | `packages/config/runtime-api.json`, checked by its test          |
| The numbers a workspace runs with               | `packages/config/src/version.ts`, written, never hand-edited     |
| Config features and their versions              | `CONFIG_FEATURES` in `packages/config/src/compatibility.ts`      |
| The release resolver                            | `scripts/resolve-release.mjs`, with its tests beside it          |
| The `@since` check                              | `scripts/check-since.mjs`, run by the Workspace job              |
| What the compatibility numbers mean and enforce | [Dependencies and compatibility](/docs/contribute/compatibility) |
