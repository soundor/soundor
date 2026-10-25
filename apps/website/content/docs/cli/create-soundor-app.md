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
`build` builds every runtime.

The project pins each Soundor package exactly, to the version this scaffolder
was released with: before 1.0 a minor release can break APIs, so a project
changes Soundor versions only when you upgrade it. Its other dependencies
(React, TypeScript, Node types) take the ranges Soundor itself is built and
tested with.

## License

MIT
