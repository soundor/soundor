# @soundor/juce-runtime

The reference Soundor runtime: JUCE plugins with a shared TypeScript/React UI, native audio processing, generated bindings, and development tooling.

The JUCE host is managed by the installed package. `soundor dev juce` and
`soundor build juce` need no initialization or `runtimes/juce/`. The project
still owns its Rust processor and controller in `native/`. For older projects,
review and migrate host customizations before removing `runtimes/juce/` yourself.

- [Guide and reference](https://soundor.dev/docs/juce-runtime)
- [Documentation](https://soundor.dev/docs)
- [Architecture](https://soundor.dev/docs/architecture)
