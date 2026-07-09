# @soundor/bridge

Typed bridge contract used by Soundor UIs and runtimes to exchange state,
events, and native calls.

## Install

```sh
pnpm add @soundor/bridge
```

## Usage

Runtime packages implement the bridge transport. UI packages consume the bridge
through runtime-provided modules such as `virtual:soundor/bridge`.

## License

MIT
