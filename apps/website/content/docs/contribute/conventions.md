---
title: 'Conventions'
description: 'Code style, errors, documentation, snippets and diagrams.'
---

## Code and dependencies

TypeScript uses oxfmt and oxlint. C++ uses clang-format 18 and clang-tidy with
the root configuration. `pnpm format:fix` formats the repository;
`pnpm lint:fix` applies supported TypeScript fixes. The pre-commit hook runs
lint-staged.

Dependencies use `catalog:` versions from `pnpm-workspace.yaml`, with strict
catalog mode and a minimum release age. Before changing `turbo.json`, read the
docs shipped with the installed Turbo package, located with
`node -p "require.resolve('turbo/package.json')"`.

Comments explain a contract, ownership rule or reason that the code cannot
express. Public props and `Style` properties need doc comments: those comments
appear in generated type tables and editor hover information.

## Errors

Name the operation that failed and give an actionable fix when one is known.
Config errors carry an issue path so users can find the invalid field. Keep
messages and failure behavior aligned across runtimes for shared APIs.

Toolchain errors use `SoundorError` and its subclasses in
`packages/core/src/errors.ts`. Dispatch preserves these and wraps other errors
in a `RuntimeError` carrying the runtime ID and phase. Native bindings use
`bind::invoke` to translate C++ exceptions into `jsi::JSError`; engine operations
report `Result<T>` across the engine API.

## Subsystem pages

Each subsystem page follows this structure:

1. Purpose.
2. Where the code is.
3. How it works, with a Mermaid diagram.
4. Invariants and the tests that enforce them.
5. How to change it.

Preserve old anchors or update their callers when splitting a page. Keep the
application-facing contract in API and component pages, and implementation
mechanics in Contribute. Explain technical tradeoffs and link recorded decision
history; distinguish an architectural inference from an original decision record.

## Documentation and live examples

The documentation is the website, [soundor.dev](https://soundor.dev): guides and
references live in `apps/website/content/docs/`, one folder per tab:
`(docs)/` (why Soundor, getting started, guides, runtimes and examples, for
plugin authors, without a tour of the packages), `components/` (a page per
component), `hooks/`, `api/` (a page per `soundor:*` module), `testing/`,
`cli/` (commands, config, create-soundor-app) and `contribute/` (work on
Soundor itself). Each folder's `meta.json` orders its sidebar, and a page's
frontmatter gives its title and description. Write
`.md`; use `.mdx` only for a page that needs a component, such as
`<Example name="basic" />`, which embeds an example's web build, or
`<Snippet name="gain" height={200} />`, which runs one file of
`examples/snippets/src/snippets/` live, its code under it. Readers can edit
an embedded example's UI code (`src/`, without tests) and a snippet, and see
them run, so that code may import only `react`, `@soundor/react`,
`soundor:*` and the example's own files (a snippet: none, but images from
`examples/snippets/src/assets/`, which the snippet's page gets the ids of).

A snippet is one small component, the file's default export, about one
thing. Add it to `examples/snippets/src/snippets/` and its `index.ts`; the
project's tests check that every file is listed, imports only what a docs
page has, and renders. `pnpm --filter snippets dev` shows
them all, with a picker. The build puts each snippet's code into the page
(`plugins/remark-snippets.ts`) and its Markdown, and fails on an unknown
name. The editor checks it with TypeScript against the example's own types
(its `tsconfig.app.json`, collected at build time by
`apps/website/scripts/types.ts`), so the example must typecheck, and its
completions and documentation on hover come from the JSDoc in the
`soundor:*` declarations and `@soundor/react`.

A component's props table is generated from its type:
`<auto-type-table path="packages/react/src/components.tsx" name="…" />`
(fumadocs-typescript, `plugins/type-tables.ts`), with `type="Omit<…>"` and a
name of its own for the component's own props. Its descriptions are the
props' doc comments, so a new prop needs one: the same comment shows in the
editor's hover and in a user's IDE.

A ` ```mermaid ` code block is drawn as a diagram (Mermaid, in the
site's theme; the page's Markdown keeps its source): prefer one to a long
description of a flow, a pipeline or a set of dependencies.

Link pages by their site path (`/docs/hooks`) and repository files by
their GitHub URL. Write versions as placeholders such as
`%version:<package>%`, which the build fills in from the repository (the list is
in `apps/website/plugins/values.ts`). Package READMEs are
short entry points linking to their page on soundor.dev, so their links also
work on npm. Legal notices remain with the dependencies they describe;
benchmark reports remain with their recorded data.

Preview the site with `pnpm turbo run dev --filter=website`. Its build
(`pnpm turbo run build --filter=website`) fails on a broken internal link or
anchor. `pnpm --filter website test` runs its unit tests, and
`pnpm --filter website test:e2e` its browser tests on the built site.

## Diagram layout

Prefer short labels and a top-to-bottom flow that fits the docs column. Split a
large graph by responsibility and check the rendered result in a browser,
including at a narrow viewport.
