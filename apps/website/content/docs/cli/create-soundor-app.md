---
title: 'create-soundor-app'
description: 'Creating a project from the template.'
---

Source: [`packages/create-soundor-app/`](https://github.com/soundor/soundor/tree/main/packages/create-soundor-app).

Project scaffolder for Soundor applications.

## Usage

```sh
pnpm create soundor-app my-plugin
# or
npm create soundor-app my-plugin
```

The scaffolder asks which runtimes the plugin targets: the JUCE runtime (the
default), the web runtime, or both. The generated project includes a Soundor
config (plugin identity, parameters, the chosen runtimes) and its
dependencies, and `soundor init` writes each runtime's host files under
`runtimes/`. The scaffolder installs the dependencies with the package
manager it was started with, pnpm or npm, the two Soundor supports. Started
any other way, it asks which of them to use.

The project's `dev` script runs [`soundor dev`](/docs/cli/dev) with the first
runtime chosen (JUCE if both are); with both, `dev:web` runs the web runtime.
`build` builds every runtime; with both, `build:juce` and `build:web` build
one. With the JUCE runtime, the project has `@soundor/vst3-host` as a
devDependency, which [`soundor dev`](/docs/cli/dev#what-soundor-dev-juce-opens)
opens the plugin in. Removing it leaves the Standalone.

## Dependency versions

The project pins each direct Soundor dependency exactly. The scaffolder first
tries the versions it was built and tested with (the template's **golden
versions**). Each independent package has its own golden version: the JUCE
runtime, web runtime and VST3 host need not share the CLI's version.

Before generating files, the scaffolder resolves the entire dependency tree
with the chosen package manager, without installing dependencies or running
install scripts. This checks transitive dependencies too, including the
engine required by the JUCE runtime. The check respects that manager's registry
and release-age policy; it never adds age exclusions or changes the policy.
For `.` it retains `.npmrc` and `pnpm-workspace.yaml` when clearing the directory.

If required versions are still awaiting publication or registry checks, or are
too young for the policy, the scaffolder tries older stable versions within
the template's declared compatibility bounds. It keeps CLI/config/React on the
same release while selecting independently versioned packages separately.
It never selects a direct Soundor dependency newer than its golden version.
A successful fallback is reported, and the generated project includes the
chosen manager's resolved lockfile so installation uses the checked tree.
Resolution checks registry metadata; the subsequent installation downloads
the packages and can still report download or install-script failures.

If no supported combination is ready, the scaffolder reports the package
manager's failure. Wait for publication or the release-age window to pass.
Changing an age policy can allow a published package; it cannot make an
unpublished version available. Network, authentication and other unrelated
failures are reported directly.

React, TypeScript and the Node and React types use the ranges Soundor itself
is built and tested with.

### Maintaining template compatibility

`packages/create-soundor-app/src/template-support.ts` declares a minimum
supported version for each direct Soundor release group. The initial minimum
is the current golden version. Subsequent compatible package releases advance
the golden version automatically at build time and leave the minimum unchanged.
When the template starts requiring a newer API or configuration, raise only
the affected minimum. Review compatibility before accepting a breaking package
release as a new golden version. The engine's constraints belong to the
selected JUCE runtime, rather than the template.

## License

MIT
