# @soundor/runtime-sdk

SDK for implementing Soundor runtime packages.

## Install

```sh
pnpm add @soundor/runtime-sdk @soundor/config @soundor/core
```

## Usage

Runtime packages use this SDK to expose lifecycle hooks for `init`, `gen`,
`dev`, `build`, and `doctor` commands.

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
