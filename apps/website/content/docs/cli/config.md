---
title: 'Configuration'
description: 'Plugin identity, editor size, parameters, typed native API declarations, signing settings, and user settings.'
---

Source: [`packages/config/`](https://github.com/soundor/soundor/tree/main/packages/config).

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

### `editor`

The plugin editor's size in logical pixels, and whether it can be resized.
It is the same in every runtime: the JUCE editor and the Web host's plugin
view open at this size and resize within these limits.

```ts
export default defineSoundorConfig({
  plugin: { id: 'com.acme.reverb', name: 'Acme Reverb' },
  editor: {
    width: 900,
    height: 560,
    minWidth: 640,
    minHeight: 400,
    maxWidth: 1600,
    maxHeight: 1000,
    resizable: true,
  },
  runtimes: [juceRuntime(), webRuntime()],
  parameters: [],
});
```

| Field                   | Meaning                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `width`, `height`       | The size the editor opens at. Default 800×600.                                                           |
| `resizable`             | Whether the user can resize the editor. Default `false`: a fixed-size editor.                            |
| `minWidth`, `minHeight` | The smallest a resizable editor can be made. Default 480×320, or the opening size where that is smaller. |
| `maxWidth`, `maxHeight` | The largest a resizable editor can be made. Default 1600×1200, or the opening size where that is larger. |

Without `editor`, a plugin keeps a fixed 800×600 editor. Every size is a
positive whole number; a minimum may not exceed its maximum, and a
resizable editor must open within its limits. The limits of a fixed editor
are ignored.

Resizing changes the size the UI is laid out at, not its zoom: a view with
`flex: 1` grows with the editor, and text keeps its size. Whether a user
can actually resize the window is up to the host: most DAWs let a plugin
window that says it is resizable be dragged by its edges, some never do.

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
notarization (see the [JUCE signing guide](/docs/juce-runtime#signing-and-distributing-on-macos)).

## License

MIT

## User settings

Soundor reads optional JSON user settings from:

- Linux and other Unix platforms: `$XDG_CONFIG_HOME/soundor/config.json`, or
  `~/.config/soundor/config.json` when XDG_CONFIG_HOME is unset or relative.
- macOS: `~/Library/Application Support/Soundor/config.json`.
- Windows: `%APPDATA%\Soundor\config.json`, falling back to
  `~/AppData/Roaming/Soundor/config.json`.

```json
{
  "devtools": { "enabled": true, "port": 4545, "open": false }
}
```

These are the defaults; the file need not exist. A port must be an integer in
1–65535. `loadUserSettings()` validates the file using Soundor's config errors;
`parseUserSettings()` validates an object and `userConfigPath()` resolves its
location. An explicit path passed to the loader takes precedence over discovery.
User settings are separate from the plugin contract in `soundor.config.ts`.
The resolved `portSource` distinguishes an omitted port from an explicit 4545:
the DevTools server may choose a higher available port only for the default.

`locateConfig(cwd)` returns the nearest `soundor.config.ts` path by searching
`cwd` and its parent directories. It throws a `ConfigError` with kind
`not-found` when discovery fails. Integrations can reuse discovery before
calling `parseConfig({ path })`.
