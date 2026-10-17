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

The generated project includes a Soundor config (plugin identity, parameters,
the JUCE runtime) and its dependencies. The scaffolder installs them with the
package manager it was started with, pnpm or npm, the two Soundor supports.
Started any other way, it asks which of them to use.

The project pins each Soundor package exactly, to the version this scaffolder
was released with: before 1.0 a minor release can break APIs, so a project
changes Soundor versions only when you upgrade it. Its other dependencies
(React, TypeScript, Node types) take the ranges Soundor itself is built and
tested with.

## License

MIT
