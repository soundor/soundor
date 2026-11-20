# @soundor/vst3-runtime

Soundor plugins as VST3 plugins for Linux, macOS and Windows: your React UI (`src/`)
and Rust processor and controller (`lib/`), linked with a prebuilt, generic
VST3 adapter (Steinberg's VST3 SDK) and the prebuilt Soundor engine. No C++ is
compiled when you build a plugin.

```ts
import { defineSoundorConfig } from '@soundor/config';
import { vst3Runtime } from '@soundor/vst3-runtime';

export default defineSoundorConfig({
  plugin: { id: 'com.acme.reverb', name: 'Acme Reverb' },
  runtimes: [vst3Runtime()],
});
```

```sh
pnpm add -D @soundor/vst3-runtime @soundor/vst3-host
soundor build vst3   # .soundor/dist/vst3/Acme Reverb.vst3
soundor dev vst3     # opens the Debug build in the VST3 host
```

Linux x86_64, macOS (Apple silicon or Intel) and Windows x64, each building
for itself. Building needs Node, Rust and the platform's linker: a C++
compiler driver (g++ or clang++) on Linux, Apple's Command Line Tools on
macOS, Visual Studio 2022 or later (or its Build Tools) on Windows.
`@soundor/vst3-host` is a required peer dependency.

- [Guide and reference](https://soundor.dev/docs/vst3-runtime)
- [Documentation](https://soundor.dev/docs)
