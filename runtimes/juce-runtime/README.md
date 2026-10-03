# @soundor/juce-runtime

**The official reference Soundor runtime.** It builds the plugin with JUCE,
binds parameters through an `AudioProcessorValueTreeState`, generates the C++
side of the plugin's `soundor:native` API, and owns the build/packaging and dev
workflows for VST3/AU.

> The plugin UI is moving to Soundor's embedded JavaScript runtime
> ([`native/`](./native/README.md)). Until it renders, the generated editor is an
> empty plugin view.

## Usage

```ts
// soundor.config.ts
import { defineSoundorConfig } from '@soundor/config';
import { juceRuntime } from '@soundor/juce-runtime';

export default defineSoundorConfig({
  plugin: { id: 'com.acme.reverb', name: 'Acme Reverb' },
  runtimes: [
    juceRuntime({
      formats: ['vst3', 'au'],
      // JUCE is never downloaded automatically — point at a checkout you accept
      // the license for (or set JUCE_DIR).
      jucePath: './JUCE',
    }),
  ],
  parameters: [
    { type: 'float', id: 'gain', label: 'Gain', min: 0, max: 1, default: 0.5 },
  ],
});
```

### Options

All options are JUCE-specific; the plugin's identity comes from the config's
top-level `plugin`.

| Option             | Default                                                                  |
| ------------------ | ------------------------------------------------------------------------ |
| `jucePath`         | `JUCE_DIR`, then well-known locations (see below)                        |
| `formats`          | `['vst3']`                                                               |
| `companyName`      | the vendor segment of `plugin.id` (`com.acme.reverb` → `acme`)           |
| `pluginCode`       | a stable four-character code derived from `plugin.id`                    |
| `manufacturerCode` | a stable four-character code derived from the vendor part of `plugin.id` |

`plugin.id` becomes the bundle identifier and `plugin.name` the product name.
Deriving the four-character codes from the id keeps two Soundor plugins from
ever sharing one in a host.

### Lifecycle phases

| Phase    | What it does                                                                                                                                                                        |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`   | Scaffolds the **user-owned** host under `runtimes/juce/` (`CMakeLists.txt`, `PluginProcessor`, `PluginEditor`). Written once; idempotent.                                           |
| `gen`    | Emits the **generated framework** under `.soundor/generated/runtimes/juce/`: `setup.cmake`, the `soundor::` base classes, and the `soundor:native` bindings. Regenerated every run. |
| `dev`    | Debug CMake build; launches the standalone app when that format is enabled.                                                                                                         |
| `build`  | Release build; packages VST3/AU under `.soundor/dist/juce`.                                                                                                                         |
| `doctor` | Verifies CMake, a C++ compiler, and a locatable JUCE checkout.                                                                                                                      |

### init vs gen: you own the host, Soundor owns the framework

`gen` produces the config-derived framework into `.soundor/generated/`: the
`soundor::AudioProcessor` / `soundor::AudioProcessorEditor` base classes, the
`soundor::native` API, and a `setup.cmake`. It is ephemeral and reproducible
(`gen --check` is stable).

`init` scaffolds the host you own: thin `PluginProcessor`/`PluginEditor`
subclasses of those bases, and a `CMakeLists.txt` whose **only** Soundor-injected
line is `include(...setup.cmake)`. Edit any of it freely — re-running `init`
never overwrites existing files.

## `soundor:native`

The config's `native` section (see `@soundor/config`) declares the plugin's
typed native API. `gen` turns it into:

- `soundor/native/SoundorNative.h` — the declared structs, enums and handle base
  classes, and a `soundor::native::NativeApi` interface to implement in C++;
- `soundor/native/SoundorNative.cpp` — the JavaScript bindings: argument
  validation, conversion, exceptions and promises.

JavaScript imports the methods from `soundor:native` with full types (from
`.soundor/generated/native.d.ts`). Typed arrays are passed to C++ without
copying, native objects travel as opaque handles, and a C++ exception becomes a
JavaScript `Error`. See [`native/README.md`](./native/README.md).

## JUCE is required (and never downloaded)

JUCE ships under a license that requires explicit acceptance, so this runtime
never fetches it. It resolves an existing checkout in order:

1. `juceRuntime({ jucePath })`
2. the `JUCE_DIR` variable (CMake's `<package>_DIR` convention — set it as an
   environment variable, or pass `-DJUCE_DIR=...` at configure time)
3. conservative well-known paths: `./JUCE`, `~/JUCE`, `~/SDKs/JUCE`, plus
   `/opt/JUCE` on Linux, `/Applications/JUCE` and `/opt/JUCE` on macOS, and
   `C:\JUCE` and `C:\SDKs\JUCE` on Windows

A directory counts as JUCE when it carries the top-level `CMakeLists.txt` and
`modules/`. `soundor doctor` reports exactly where it looked when JUCE is
missing.

## License

MIT
