# @soundor/config

Configuration helpers and schema validation for `soundor.config.ts` files.

## Install

```sh
pnpm add -D @soundor/config
```

## Usage

```ts
import { defineSoundorConfig } from '@soundor/config';

export default defineSoundorConfig({
  plugin: { id: 'com.acme.reverb', name: 'Acme Reverb' },
  runtimes: [],
  parameters: [],
});
```

The config is declarative: it describes what the plugin is and exposes, never
how. `parseConfig` validates it and reports every problem with its path.

### `plugin`

| Field  | Meaning                                                                                                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`   | Stable, globally unique reverse-DNS id (`com.acme.reverb`). Runtimes derive format identities from it, and Soundor isolates the plugin's native code by it. Never change it after release. |
| `name` | The display name hosts show.                                                                                                                                                               |

### `native`

The plugin's typed native API, implemented in C++ and imported by JavaScript
from `soundor:native`:

```ts
native: {
  types: {
    Analysis: { struct: { rms: 'number', peak: 'number' } },
    Curve: { enum: ['linear', 'exponential'] },
    Preset: 'handle',
  },
  methods: {
    analyze: { args: { samples: 'Float32Array' }, returns: 'Analysis' },
    setCurve: { args: { curve: 'Curve' } },
    loadPreset: { args: { path: 'string' }, returns: 'Preset', async: true },
  },
}
```

```ts
import { analyze, loadPreset } from 'soundor:native';

const { rms } = analyze(samples);
const preset = await loadPreset('/presets/warm.json');
```

Methods take positional arguments in the order declared and return `returns`
(default `void`); `async: true` methods return a `Promise`. Type references:

| Type                                                                      | JavaScript                                | C++ argument → result                                                      |
| ------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| `boolean`, `number`, `string`                                             | primitives                                | `bool`, `double`, `std::string`                                            |
| `ArrayBuffer`, `Uint8Array`, `Int32Array`, `Float32Array`, `Float64Array` | binary data                               | `std::span<const T>` (zero-copy, valid during the call) → `std::vector<T>` |
| a `struct` type                                                           | plain object                              | `struct`                                                                   |
| an `enum` type                                                            | string literal union                      | `enum class`                                                               |
| a `'handle'` type                                                         | opaque object only native code can create | `std::shared_ptr<T>`                                                       |
| `T[]` (one level; not binary)                                             | array                                     | `std::vector<T>`                                                           |

Struct fields may be primitives, enums, structs or arrays of them. Method,
argument and field names are camelCase; type names are PascalCase.

### `signing`

How runtimes sign the binaries they build. Optional; nothing here is secret.

```ts
signing: {
  macos: { identity: 'Developer ID Application: Acme (ABCDE12345)' },
},
```

| Field            | Meaning                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `macos.identity` | The name of a code signing certificate in the macOS keychain, or its SHA-1 hash (`security find-identity -v -p codesigning` lists them). Defaults to ad-hoc (`-`). |

Two environment variables, read by every runtime, take part:

| Variable                         | Meaning                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| `SOUNDOR_MACOS_SIGNING_IDENTITY` | Overrides `signing.macos.identity`, e.g. to sign only in CI.                               |
| `SOUNDOR_MACOS_KEYCHAIN`         | A keychain to search besides the default list, for CI setups that do not add theirs to it. |

An identity is only a name: `codesign` finds the private key in the keychain,
so key material never goes in the config or these variables, and validation
rejects anything that looks like it. Ad-hoc signing is enough to use a plugin
on the Mac that built it; distributing one needs a Developer ID identity and
notarization (see the JUCE runtime's README).

## License

MIT
