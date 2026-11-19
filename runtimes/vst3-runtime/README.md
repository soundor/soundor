# @soundor/vst3-runtime

Soundor plugins as Linux VST3 plugins, without JUCE: your React UI (`src/`)
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
soundor build vst3   # .soundor/dist/vst3/Acme Reverb.vst3
```

Linux x86_64 only. Building needs Node, Rust and a C++ compiler driver (g++
or clang++) to link.

- [Guide and reference](https://soundor.dev/docs/vst3-runtime)
- [Documentation](https://soundor.dev/docs)
