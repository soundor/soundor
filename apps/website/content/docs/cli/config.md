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
  parameters: {},
});
```

The config is declarative: it describes what the plugin is and exposes, never
how. `parseConfig` validates it and reports every problem with its path. A
property the schema does not have is one of them, never dropped: a typo, or a
setting of a newer Soundor release that this one, and its runtimes, would
otherwise ignore.

Install `soundor` and `@soundor/config` at the same version, as
`create-soundor-app` does: the CLI parses the config with its own
`@soundor/config`, and refuses a project whose `@soundor/config` is of another
release line (another minor before 1.0). Runtime packages declare supported
CLI releases through their `soundor` peer dependency; the package manager
handles mismatches
([Dependencies and compatibility](/docs/contribute/compatibility)).

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
  parameters: {},
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

### `parameters`

The plugin's parameters, by id: the key is the stable identity hosts store in
sessions and automation, so never rename one after release.

```ts
parameters: {
  cutoff: {
    type: 'float32',
    label: 'Cutoff',
    min: 20,
    max: 20000,
    default: 1000,
    mapping: 'log',
    unit: 'Hz',
  },
  mode: {
    type: 'choice',
    options: [
      { value: 'clean', label: 'Clean' },
      { value: 'warm', label: 'Warm' },
    ],
    default: 'clean',
    access: 'manual',
  },
},
```

| Field             | Meaning                                                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`            | `float32`; `int8`, `uint8`, `int16`, `uint16`, `int32`, `uint32`; `boolean`; `choice`. `int64`, `uint64`, `float64` are refused.                                      |
| `label`           | What hosts show. Default: the id.                                                                                                                                     |
| `access`          | `'automatable'` (default), `'manual'` (not automated by hosts), or `'readOnly'` (set by the processing: a meter).                                                     |
| `min`, `max`      | The range of a numeric parameter. Integer values stay within ±2^24.                                                                                                   |
| `default`         | In the range and on the step's grid; a boolean; or one of a choice's option values.                                                                                   |
| `step`            | Values are `min + k · step`, and `max`; an integer's step divides its range.                                                                                          |
| `unit`            | Shown after the value (`'dB'`), and optional in typed text.                                                                                                           |
| `mapping`         | `float32` only: `'linear'` (default), `'log'`, `{ type: 'power', exponent }`, `{ type: 'symmetricPower', exponent }`, or `{ type: 'custom', toValue, toNormalized }`. |
| `format`, `parse` | A numeric parameter's text, as expressions. A `format` needs a `parse` (or `parse: 'default'`).                                                                       |
| `options`         | A choice's `{ value, label }` list. Hosts store the index: add options at the end.                                                                                    |

Loading the config checks each parameter and reports every problem with its
path, custom mappings and `format`/`parse` round trips included. See
[Parameters](/docs/parameters) for what each field does.

### `native`

The plugin's typed native API, implemented in C++ and imported by JavaScript
from `soundor:native`:

```ts
native: {
  types: {
    Analysis: { struct: { rms: 'float32', peak: 'float32' } },
    Curve: { enum: ['linear', 'exponential'] },
    Preset: { struct: { name: 'string', gains: 'float32[]' } },
  },
  methods: {
    analyze: { args: { samples: 'buffer<float32>' }, returns: 'Analysis' },
    getSpectrum: { returns: 'buffer<float32>' },
    setCurve: { args: { curve: 'Curve' } },
    loadPreset: { args: { path: 'string' }, returns: 'Preset?', async: true },
    applyPreset: { args: { preset: 'Preset' } },
    setSolo: { args: { slot: 'int32?' } },
  },
}
```

```ts
import { analyze, loadPreset, setSolo } from 'soundor:native';

const { rms } = analyze(samples);
const preset = await loadPreset('/presets/warm.json'); // Preset | null
setSolo(null);
```

Methods take positional arguments in the order declared and return `returns`
(default `void`); `async: true` methods return a `Promise`. The types say what
a value is, not what a language calls it, so the same declaration maps onto
TypeScript, C++ and any later runtime:

| Type                        | TypeScript               | C++                                                       |
| --------------------------- | ------------------------ | --------------------------------------------------------- |
| `boolean`                   | `boolean`                | `bool`                                                    |
| `string`                    | `string`                 | `std::string`                                             |
| `int8`, `uint8`, `int16`    | `number`                 | `std::int8_t`, `std::uint8_t`, `std::int16_t`             |
| `uint16`, `int32`, `uint32` | `number`                 | `std::uint16_t`, `std::int32_t`, `std::uint32_t`          |
| `int64`, `uint64`           | `bigint`                 | `std::int64_t`, `std::uint64_t`                           |
| `float32`, `float64`        | `number`                 | `float`, `double`                                         |
| a `struct` type             | interface (plain object) | `struct`                                                  |
| an `enum` type              | string literal union     | `enum class`                                              |
| `T[]`                       | `T[]`                    | `std::vector<T>`                                          |
| `buffer<T>`                 | typed array (see below)  | argument `std::span<const T>`, otherwise `std::vector<T>` |
| `T?`                        | `T \| null`              | `std::optional<T>`                                        |

`void` is only a return type. Method, argument and field names are camelCase;
type names are PascalCase.

- **Numbers have a size.** There is no plain `number`: an integer type takes
  an integer within its range, a float32 is rounded to the nearest float, and
  64-bit integers are `bigint`s, so their whole range is exact. Nothing is
  coerced: `1.5` for an `int32`, `'1'` for a `float64` or `1` for an `int64`
  is a `TypeError`, `256` for a `uint8` a `RangeError`.
- **`T[]` is a list of values:** primitives, enums or structs, copied across
  and checked element by element. Not nested (`T[][]`): put the inner list in
  a struct.
- **`buffer<T>` is contiguous binary numbers** of one sized numeric type:
  `buffer<int8>` is an `Int8Array`, `buffer<uint8>` a `Uint8Array`, and so on
  to `buffer<int64>` (`BigInt64Array`), `buffer<uint64>` (`BigUint64Array`),
  `buffer<float32>` (`Float32Array`) and `buffer<float64>` (`Float64Array`),
  exactly that type (not an `ArrayBuffer` or another typed array). It moves
  without per-element conversion, but it is not shared memory: a method
  argument is lent to C++ for the call, and a buffer anywhere else (a result,
  a struct field) is a copy JavaScript owns.
- **`T?` means nullable, not optional:** the value is `null` or a `T`, and an
  argument must still be passed. `undefined` is never a value. Any type but
  `void` can be nullable (`'Preset?'`, `'float32[]?'`, `'buffer<float32>?'`),
  except an array's elements.
- **Structs are values**, any of the types above as fields. One that needs to
  stand for something native, such as a loaded file, carries what the UI shows
  and an ID or path the native side looks it up by; there are no opaque
  native objects in JavaScript.

`events` declares what native code tells the UI: each event names the fields
of its value, of the types above, in order (an event may have none). Its
value is `events::<Name>` in C++ (`presetLoaded` → `events::PresetLoaded`),
which no declared type may be called, and an object in TypeScript:

```ts
native: {
  events: {
    presetLoaded: { path: 'string', preset: 'Preset?' },
    ready: {},
  },
}
```

```ts
import { events } from 'soundor:native';

events.presetLoaded.subscribe(({ path, preset }) => {});
```

Event names are camelCase; `events`, `publish`, `statistics` and `hub` are
taken, and no method can be called `events`. See
[`soundor:native`](/docs/api/native#events) for how they are delivered.

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

## Persistent state

The optional top-level `state` section declares typed application data persisted
with the plugin, independently of its editor. Types reuse `native.types`; every
field requires a validated default. See [`soundor:state`](/docs/api/state) for
configuration and JavaScript/native examples. Runtime API 2 adds this feature;
a runtime implementing an older API is refused when state is declared.
