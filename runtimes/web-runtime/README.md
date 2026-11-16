# @soundor/web-runtime

Runs a Soundor plugin in the browser.

- [Guide and reference](https://soundor.dev/docs/web-runtime)
- [Documentation](https://soundor.dev/docs)
- [Architecture](https://soundor.dev/docs/architecture)

The Web host is managed by this package: no `runtimes/web/` or web initialization
is needed. Configure built-ins with `webRuntime({ inputs: [{ type: 'oscillator' }] })`
or a browser module with `webRuntime({ inputs: './web/inputs.ts' })`. The latter
default-exports an array using `defineInput`, `oscillator`, `audioFile` and
`microphone` from `@soundor/web-runtime/input`. See the guide for browser types
and migration of existing hosts.
