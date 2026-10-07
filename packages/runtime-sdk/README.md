# @soundor/runtime-sdk

SDK for implementing Soundor runtime packages.

## Install

```sh
pnpm add @soundor/runtime-sdk @soundor/config @soundor/core
```

## Usage

Runtime packages use this SDK to expose lifecycle hooks for `init`, `gen`,
`dev`, `build`, and `doctor` commands.

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
