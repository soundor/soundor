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

| Field                   | Meaning                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `width`, `height`       | The size the editor opens at. Default 800×600.                                                              |
| `resizable`             | Whether the user can resize the editor. Default `false`: a fixed-size editor.                               |
| `resize`                | What resizing does: `'layout'` (the default) lays the UI out again; `'scale'` zooms it. See below.          |
| `minWidth`, `minHeight` | The smallest a resizable editor can be made. Default: the opening size, so it only grows.                   |
| `maxWidth`, `maxHeight` | The largest size a resizable editor asks for. Default: none (`Infinity`). See below.                        |
| `fit`                   | With `resizable` only: what the UI does in a window larger than its maximum, or (scaling) of another shape. |
| `keepAspectRatio`       | With `resize: 'scale'` only: whether the editor asks to keep its shape. Default `true`. See below.          |

Without `editor`, a plugin keeps a fixed 800×600 editor. Every size is a
positive whole number (a maximum may also be `Infinity`); a minimum may not
exceed its maximum, and a resizable editor must open within its limits. The
limits of a fixed editor are ignored.

By default resizing changes the size the UI is laid out at, not its zoom: a
view with `flex: 1` grows with the editor, and text keeps its size. With
`resize: 'scale'` it is the other way round: the UI is always laid out at
`width`×`height`, and resizing draws that same layout larger or smaller,
the window keeping its aspect ratio. Nothing moves, which suits a plugin
with many controls whose users find them by where they are:

```ts
editor: { width: 900, height: 560, resizable: true, resize: 'scale' },
```

By default a resizable editor opens at its size and only grows, as far as
the host and the screen let it. Set `minWidth`/`minHeight` to let it shrink
below its opening size, and `maxWidth`/`maxHeight` where the UI stops
making sense larger.

Whether a user can actually resize the window is up to the host: most DAWs
let a plugin window that says it is resizable be dragged by its edges, some
never do.

#### Limits, `fit` and `keepAspectRatio`: windows the UI was not made for

The limits, and the aspect ratio of an editor that scales, are what the
editor **asks for**: it offers them to its host (VST3's
`checkSizeConstraint`), the Standalone's window keeps to them, and so does
the web host's resize handle. Most hosts follow them. Some set a window of
any size or shape regardless (Ardour, for one, lets a plugin window grow
past its maximum and take any shape), and a web page that embeds the
editor (`?embed`) makes it the size of its iframe. The editor then takes
that window, keeping only to its minimum: rather than leave the host's
background beside it, its UI fills the window as `fit` says.

- `'contain'` (the default) keeps the UI as it was made: laid out at most at
  `maxWidth`×`maxHeight` (or, scaling, at `width`×`height`, zoomed by the
  smaller side, at most as far as the maximum allows), in the middle of the
  window, with bands of the editor's background around it. The UI needs to
  know nothing.
- `'cover'` lays the UI out over the whole window. Laying out again, the
  window's size; scaling, the window's size over the zoom. The part it was
  made for, in the middle, is its **safe area**: `viewSize().safeArea` (and
  `useViewSize()`) says where (at most the maximum, or scaling the
  `width`×`height`). The UI keeps its content there and decorates the rest
  (its background, a pattern, its branding).

`keepAspectRatio: false` (scaling only) asks for no shape at all: the
window may take any shape within its limits, everywhere, and `fit` decides
how the UI fills it. The settings are independent: `cover` with the aspect
ratio kept draws the UI edge to edge only where a host or a page imposes
another shape; `cover` with `keepAspectRatio: false` lets the user drag the
window to any shape and fills it.

```ts
editor: {
  width: 900,
  height: 560,
  resizable: true,
  resize: 'scale',
  fit: 'cover',
  keepAspectRatio: false,
},
```

```tsx
function App() {
  const { width, height, safeArea } = useViewSize();
  return (
    // The whole window: decorate it.
    <View style={{ width, height, backgroundColor: '#14161c' }}>
      {/* The safe area: the UI as designed, always shown whole. */}
      <View
        style={{
          position: 'absolute',
          left: safeArea.x,
          top: safeArea.y,
          width: safeArea.width,
          height: safeArea.height,
        }}
      >
        <Controls />
      </View>
    </View>
  );
}
```

Within its limits, and in its own shape, the safe area is the whole view, so
the same UI works whatever `fit` is. Without a maximum (the default) a
layout never goes beyond it, so `fit` matters only once a plugin sets one,
or scales. A fixed editor has no `fit`: hosts keep a view that says it
cannot be resized at its size (the VST3 standard), so there is nothing
beyond it to fill. `fit` is only allowed with `resizable: true`, and
`keepAspectRatio` with `resize: 'scale'`: the config's types reject them
elsewhere, and so does validation of a config that is not type-checked.

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
