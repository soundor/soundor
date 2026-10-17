---
title: 'Core'
description: '@soundor/core: shared toolchain utilities, runtime declarations, and spring helpers.'
---

Source: [`packages/core/`](https://github.com/soundor/soundor/tree/main/packages/core).

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
