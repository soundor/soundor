# @soundor/core

[Documentation](README.md) · [The idea](overview.md) · [Getting started](getting-started.md) · [Architecture](architecture.md)

Source: [`packages/core/`](../packages/core/).

**On this page**

- [Install](#install)
- [Usage](#usage)
- [Shared spring helpers](#shared-spring-helpers)
- [License](#license)

Core utilities and contracts shared by the Soundor toolchain, runtime packages,
and integrations.

## Install

```sh
pnpm add @soundor/core
```

## Usage

Most applications consume this package through `@soundor/cli`,
`@soundor/config`, or a runtime package. Use it directly when building Soundor
tooling or runtime integrations.

## Shared spring helpers

`@soundor/core/spring` exports `springParameters`, `sampleSpring`, and
`springDuration`. This independent entry contains the analytic solver shared by
the Web and simulated test runtimes; it loads no Node or browser services.

## License

MIT

---

Previous: [React tests](react-tests.md) · Next: [@soundor/runtime-sdk](runtime-sdk.md)
