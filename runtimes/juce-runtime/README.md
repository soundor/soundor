# @soundor/juce-runtime

**The official reference Soundor runtime.** It builds the plugin with JUCE,
binds parameters through an `AudioProcessorValueTreeState`, generates the C++
side of the plugin's `soundor:native` API, and owns the build/packaging and dev
workflows for VST3/AU.

Each plugin view hosts Soundor's embedded JavaScript runtime
([`native/`](./native/README.md)), running the project's UI bundle (`src/main.ts[x]`,
bundled by the CLI) with the `soundor:*` modules. Rendering a UI from it comes
later; until then the view is empty.

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
| `dev`    | Debug CMake build with the development UI bundle embedded; launches the standalone app when that format is enabled. Signed ad-hoc on macOS.                                         |
| `build`  | Release build with the production UI bundle embedded; signs it on macOS (see [Signing](#signing-and-distributing-on-macos)) and packages VST3/AU under `.soundor/dist/juce`.        |
| `doctor` | Verifies CMake, a C++ compiler, the tools Skia and ANGLE are built with (git, Python 3, Ninja), and a locatable JUCE checkout.                                                      |

### init vs gen: you own the host, Soundor owns the framework

`gen` produces the config-derived framework into `.soundor/generated/`: the
`soundor::AudioProcessor` / `soundor::AudioProcessorEditor` base classes, the
`soundor::native` API, and a `setup.cmake`. It is ephemeral and reproducible
(`gen --check` is stable).

`init` scaffolds the host you own: thin `PluginProcessor`/`PluginEditor`
subclasses of those bases, and a `CMakeLists.txt` whose **only** Soundor-injected
line is `include(...setup.cmake)`. Edit any of it freely — re-running `init`
never overwrites existing files.

## The plugin's JavaScript runtime

The generated `soundor::AudioProcessorEditor` owns a `soundor::RuntimeHost` for
as long as the view is open: a QuickJS runtime on the message thread, ticked at
60 Hz to deliver parameter changes and run pending jobs. Nothing JavaScript ever
runs on the audio thread.

### `soundor:parameters`

Every config parameter, backed directly by the processor's
`AudioProcessorValueTreeState`. There is no second parameter store:

```ts
import { parameters } from 'soundor:parameters';

parameters.gain.set(0.5);
const stop = parameters.gain.subscribe((gain) => drawKnob(gain));
```

JUCE's parameter listeners only set a lock-free flag (they may run on the audio
thread). Host automation, preset loads and UI changes all reach subscribers on
the message thread. Gestures (`beginGesture`/`endGesture`) map to JUCE's change
gestures, so hosts record UI drags as automation.

### `soundor:native`

The config's `native` section (see `@soundor/config`) declares the plugin's
typed native API. `gen` turns it into:

- `soundor/native/SoundorNative.h` — the declared structs, enums and handle base
  classes, and a `soundor::native::NativeApi` interface to implement in C++;
- `soundor/native/SoundorNative.cpp` — the JavaScript bindings: argument
  validation, conversion, exceptions and promises.

Implement it by overriding `createNativeApi()` in your processor:

```cpp
std::shared_ptr<soundor::native::NativeApi> createNativeApi() override
{
    return std::make_shared<MyNativeApi>(*this);
}
```

JavaScript imports the methods from `soundor:native` with full types (from
`.soundor/generated/native.d.ts`). Typed arrays are passed to C++ without
copying, native objects travel as opaque handles, and a C++ exception becomes a
JavaScript `Error`. See [`native/README.md`](./native/README.md).

### Web APIs, `soundor:host`, `soundor:storage`, `soundor:fs`

Each runtime has Soundor's Web-compatible globals (`console`, timers, `URL`,
`fetch`, `crypto`, …) and the host/storage/file modules (see
[`native/README.md`](./native/README.md)). The JUCE backend provides:

- **`fetch`** over `juce::URL` on a small thread pool. Linux builds use
  `JUCE_USE_CURL=0`, which supports plain `http` only; `https` there needs
  libcurl enabled in JUCE.
- **The transport** for `soundor:host`. The generated base processor captures
  the play head in `processBlock()`, so your processor implements `process()`
  instead, with the same signature.
- **The data directory** `<user application data>/Soundor/<plugin.id>` for
  storage and files.

### Accessibility

The view is accessible to screen readers through Soundor's own semantics
(the accessibility props of `@soundor/react`), not through JUCE's
`AccessibilityHandler`. The generated editor only tells Soundor's platform
backend where the view is: its peer's native window, the surface's place
and scale in it, and whether it has focus. On Windows (UI Automation) and
Linux x64 (AT-SPI) that backend is AccessKit, fetched prebuilt and pinned
(no Rust toolchain needed). On macOS it is Soundor's own VoiceOver bridge:
the editor hands JUCE a container of Soundor's elements as its native
accessibility child (`AccessibilityHandler::setNativeChildForComponent`),
JUCE's only part in it. See
[`native/README.md`](./native/README.md#platform-accessibility).

A plugin binary then contains AccessKit (MIT or Apache-2.0, with Chromium
BSD-3-Clause code): ship its notices with the plugin.

### Build integration

`setup.cmake` builds the runtime from this package's `native/` sources into the
plugin. QuickJS-NG is fetched by CMake at a pinned revision; no extra developer
installs are needed. Every Soundor symbol is mangled into the plugin's own ABI
namespace, derived from `plugin.id`. The plugin binary exports only its format
entry points.

The UI bundle the CLI built is compiled into the plugin (`soundor_embed_directory`),
so a plugin needs no files beside itself. The generated editor loads its
`bundle.js` into the view's runtime.

`dev` and `build` configure CMake with **Ninja** on macOS and Linux, and with
CMake's default, **Visual Studio**, on Windows. A build tree configured with
another generator (as earlier Soundor versions left on macOS and Linux) is
deleted and configured afresh.

The last build step of every format is `soundor_finalize_plugin`
(`native/cmake/SoundorPluginBundle.cmake`), deferred to the end of the
project's `CMakeLists.txt` so it also follows steps the project adds: it writes
the VST3 `moduleinfo.json` (JUCE's automatic manifest is turned off, since
JUCE writes it after signing) and, on macOS, signs and verifies each bundle.

## Signing and distributing on macOS

`soundor build` signs every bundle with the identity resolved from
`SOUNDOR_MACOS_SIGNING_IDENTITY`, then the config's `signing.macos.identity`
(see `@soundor/config`), then ad-hoc. It verifies the signature
(`codesign --verify --deep --strict`), so a broken one fails the build rather
than a host's plugin scan. `soundor dev` always signs ad-hoc, which needs no
network and leaves the plugin debuggable.

- **Ad-hoc** (the default) is enough to use the plugin on the Mac that built
  it. No Apple account is involved.
- **To distribute** it, sign with a _Developer ID Application_ certificate
  from a paid Apple Developer account. With a real identity Soundor adds the
  hardened runtime and a secure timestamp, which notarization requires:

  ```sh
  SOUNDOR_MACOS_SIGNING_IDENTITY="Developer ID Application: Acme (ABCDE12345)" soundor build
  ```

  In CI, import the certificate into a keychain first (for example with
  `Apple-Actions/import-codesign-certs`); set `SOUNDOR_MACOS_KEYCHAIN` if the
  step does not add that keychain to the search list.

- **Where to set the identity:** usually only as
  `SOUNDOR_MACOS_SIGNING_IDENTITY` in the release CI job. Put it in
  `signing.macos.identity` only if everyone who runs `soundor build` has the
  certificate and its private key: otherwise their build fails at the signing
  step. `SOUNDOR_MACOS_SIGNING_IDENTITY=- soundor build` signs ad-hoc whatever
  the config says; only the link and signing steps run again.

Notarization is yours to run on what you ship; downloaded files are
quarantined, and Gatekeeper blocks plugins Apple has not notarized. For a
bundle shipped in a zip or disk image:

```sh
cd .soundor/dist/juce/MyPlugin_artefacts/Release/VST3
ditto -c -k --keepParent "My Plugin.vst3" MyPlugin.zip
xcrun notarytool submit MyPlugin.zip --keychain-profile <profile> --wait
xcrun stapler staple "My Plugin.vst3"   # then zip the stapled bundle to ship
xcrun stapler validate "My Plugin.vst3"
```

`<profile>` is stored once with `xcrun notarytool store-credentials`; in CI,
pass `--key`, `--key-id` and `--issuer` (an App Store Connect API key)
instead. If you ship a `.pkg` installer, sign it with your _Developer ID
Installer_ certificate (`productbuild --sign`) and notarize and staple the
`.pkg` instead.

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
