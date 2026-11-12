---
title: 'Runtime SDK'
description: 'Writing a runtime: compatibility, lifecycle context, DevTools capabilities, and signing.'
---

Source: [`packages/runtime-sdk/`](https://github.com/soundor/soundor/tree/main/packages/runtime-sdk).

SDK for implementing Soundor runtime packages.

For the full authoring path, start with [Build a runtime](/docs/contribute/build-runtime).
Its [lifecycle guide](/docs/contribute/build-runtime/lifecycle) covers the shared
context, and its [execution contract](/docs/contribute/build-runtime/contract)
describes the environment a runtime must provide in addition to these hooks.

## Install

```sh
pnpm add @soundor/runtime-sdk
```

It is the one Soundor package a runtime imports: it re-exports all of
`@soundor/config` and `@soundor/core`, so import everything from it. A
runtime that also installed those would risk copies of them that its SDK's do
not share, and declarations naming packages its users may not have.

The root entry is for the runtime's Node side (its lifecycle phases). Code
that runs with the plugin's UI, in a browser or an embedded engine, imports
from `@soundor/runtime-sdk/client` instead: helpers that import nothing of
Node or the toolchain, such as core's springs (`springParameters`,
`sampleSpring`, `springDuration`), the same the other runtimes animate with.

## Usage

Runtime packages use this SDK to expose lifecycle hooks for `init`, `gen`,
`dev`, `build`, and `doctor` commands.

### Compatibility

Declare supported CLI releases through a required `soundor` peer dependency,
using a caret range such as `^%version:soundor%`. Keep
`@soundor/runtime-sdk` as a regular dependency. They share the fixed package
version, so the SDK release you build against identifies the host release
line to support. Before 1.0, the caret range accepts patches within that minor.

Runtime providers own compatibility and update their peer range after testing
a new release. The package manager handles peer mismatches; the CLI does not
perform an additional runtime-version check. See
[Dependencies and compatibility](/docs/contribute/compatibility).
The SDK re-exports the error protocol (`isSoundorError`, `isConfigError`) for
errors from other copies of the packages.

### Optional DevTools capability

Declare support on the definition passed to `defineRuntime`, without launching
the runtime:

```ts
capabilities: {
  devtools: { inspector: true, accessibility: true, animations: true, performance: true },
},
```

All fields are optional. Existing definitions need no changes. Omit `devtools`
for unsupported runtimes; an empty declaration advertises basic connection
support. This static declaration is separate from the capabilities negotiated
by each connected instance. The CLI checks support before loading user settings
or initializing debugging infrastructure. The Web runtime does not declare it.

`LifecycleContext.devtools`, when supplied, carries the active session's
`endpoint`, `sessionId` and `token`. Dispatch forwards it only during `dev` in
debug mode to a runtime declaring support. Treat these credentials as secrets:
do not log them, include them in process arguments, or embed them in builds.
The connection context is optional even for a supported runtime (disabled
settings or unavailable infrastructure). Continue normal development without it.
The server and protocol are delivered separately from this capability foundation.

`LifecycleContext.session`, supplied by `soundor dev`, is how a long-lived
`dev` phase talks to the developer's terminal. Call `ctx.session.ready(rows)`
once the runtime is up (and again after anything it rebuilds): the CLI prints
its summary with `rows` (`{ label, value }`, such as a URL to open) after its
own. `ctx.session.shortcut({ key, description, action })` adds a shortcut that
runs when `key` and enter are typed; the CLI's own keys (`h`, `u`, `o`, `c`,
`q`) are reserved. Output piped through `ctx.logger.pipe` (as `runCommand`
does) is collapsed into a progress line in a terminal and kept in
`.soundor/dev/build.log`, so the summary stays on screen.

### Signing

The CLI resolves code signing once and hands it to every phase as
`ctx.signing`: `SOUNDOR_MACOS_SIGNING_IDENTITY`, then the config's
`signing.macos.identity`, then ad-hoc (`-`). A runtime that produces macOS
binaries must:

- sign every one of them with `ctx.signing.macos.identity` (and
  `ctx.signing.macos.keychain` when set), as the **last** step of its build,
  after anything that writes into a bundle;
- add `--options runtime --timestamp` when the identity is not ad-hoc, since
  notarization requires both;
- never read the environment variables itself, so every runtime follows the
  same precedence.

## License

MIT
