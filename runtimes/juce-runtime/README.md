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

| Option             | Default                                                                       |
| ------------------ | ----------------------------------------------------------------------------- |
| `jucePath`         | `JUCE_DIR`, then well-known locations (see below)                             |
| `formats`          | `['vst3']`                                                                    |
| `companyName`      | the vendor segment of `plugin.id` (`com.acme.reverb` → `acme`)                |
| `pluginCode`       | a stable four-character code derived from `plugin.id`                         |
| `manufacturerCode` | a stable four-character code derived from the vendor part of `plugin.id`      |
| `timeLimit`        | `5000`: milliseconds one call into the UI's JavaScript may run; `false`: none |

`plugin.id` becomes the bundle identifier and `plugin.name` the product name.
Deriving the four-character codes from the id keeps two Soundor plugins from
ever sharing one in a host.

`timeLimit` protects the host from a UI script that never returns. The UI's
JavaScript runs on the host's UI thread, so a loop that never ends there would
freeze the whole host (its audio keeps playing) until the user force-quits it.
Past the limit, the runtime stops the script, whether a frame, an event, a
timer or startup: it throws a `TimeoutError` that JavaScript cannot catch, the
error is logged with its stack (in `soundor dev`, in your terminal, mapped to
your source), and the UI keeps its last picture without responding until the
editor is opened again or `soundor dev` reloads it. The default, 5 seconds, is
about when an operating system shows a window as not responding; an ordinary
frame takes a few milliseconds, and starting a UI from bytecode about ten.

What counts is running, not waiting: `await` on a fetch, a file read or a
timer ends the call, and the code after it runs in a later one with a limit of
its own. A synchronous `soundor:native` call counts in full, though: the
engine cannot stop C++, so a method that takes six seconds (loading a sample
library, say) gets its script stopped as soon as it returns. Make such a
method `async`, so that JavaScript awaits it, or do the work in the processor,
which exists long before the editor opens; raise the limit only for a plugin
that knowingly runs long in one call.

### Lifecycle phases

The runtime declares optional Soundor DevTools support for native inspection,
accessibility, animations and performance. The CLI discovers support before
launch; connected instances negotiate the features actually implemented.
Currently the development Standalone bridge negotiates inspection and
accessibility. Animation/performance diagnostics are added separately.

`soundor dev juce` enables the bridge only with an active `ctx.devtools` session.
Include `standalone` in `formats` to launch a native window. The CLI passes only
the protected descriptor path through `SOUNDOR_DEVTOOLS_SESSION`, including on
macOS where it launches the bundle's executable directly to preserve that
environment. It discovers both `Debug/Standalone` and older unconfigured
artifact directories. There is one server per development session, not per view.

The bridge reads Soundor's actual C++ tree, normalized base/presentation styles,
Yoga layout results, focus and accessibility semantics. Highlights are a cached
final compositor layer, independent of UI layout and hit testing. Native picking
intercepts press/release, capture, focus and Escape before application dispatch;
selecting a control does not activate it. Reloads change node generations;
disconnects clear debug state. Nothing traverses JUCE components or streams the
window into the browser.

Networking and JSON parsing run on workers, with bounded plain-data queues.
Hermes, tree inspection and debug mutations remain on the UI thread. The bridge
connects only to its designated protected session; no port scanning. It retries
after transport loss and can accept an explicit descriptor update for a new
session of the same project. Existing Standalones disconnected by a CLI restart
are not automatically transferred into another session.

Production builds force `SOUNDOR_ENABLE_DEVTOOLS=OFF` and clear development
bundle/log paths. Debug sources and interfaces are excluded at compile time;
no listener or bridge starts in a release artifact. The generated integration
activates only for the Standalone wrapper, never a DAW plugin. Development
continues normally when debugging is disabled or unavailable.

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
as long as the view is open: a Hermes runtime (interpreted, no JIT) on the
message thread, ticked at 60 Hz to deliver parameter changes and run pending
jobs. Nothing JavaScript ever runs on the audio thread.

A built plugin (`soundor build`) embeds its UI bundle compiled to Hermes
bytecode by the `hermesc` of the same Hermes build, and links the VM without
its compiler. The bytecode keeps line and column numbers, so stack traces point
at lines, but not source text: a function's `toString()` cannot return its
code. `soundor dev` runs the bundle from source, with the compiler linked, but
JavaScript compiles none in either: `eval()` and `new Function()` throw, so a
dependency that generates code at run time (a schema validator compiling its
checks, a template engine) needs its build-time form, and this shows up in
development rather than in the built plugin. The bundle the CLI makes for this runtime (`bundle.js`) is a CommonJS module
function with the syntax Hermes lacks lowered; see
[`native/README.md`](./native/README.md#modules) for what that changes, and
[the engine](./native/README.md#the-javascript-engine) for the language.

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

### Canvases: 2D and WebGL

A canvas node draws with `getContext('2d')`, which uses Skia on the CPU, or
with `getContext('webgl2')`, which uses ANGLE on the GPU. WebGL needs a
hardware GPU. Where there is none (a VM, a headless Linux machine),
`getContext('webgl2')` returns null and the plugin log says why, so code
should fall back. Three.js's `WebGLRenderer` runs on it unmodified, and the
native tests check that. The GPU compositor shows WebGL as it is, without copies;
where the UI is composited on the CPU (Linux), WebGL is read back. See
[`native/README.md`](./native/README.md).

### Performance: what a frame costs

The UI's JavaScript runs in an interpreter (Hermes, with no JIT: plugin hosts
do not all allow one), on the host's message thread, so a slow frame also
stalls the host's own UI. Layout, drawing and compositing are native and cheap;
what costs is JavaScript run every frame. Measured with
[`examples/benchmark`](../../examples/benchmark) (Linux, an RTX 4050), per
frame:

- **Give per-frame work to the GPU.** 200,000 points moved by JavaScript: 28
  ms. The same points moved by the vertex shader, JavaScript setting one
  `time` uniform: 0.1 ms.
- **Compute in C++.** FFTs, peaks, envelopes belong in the plugin's native API
  (`soundor:native`), or on the audio side; JavaScript draws the result.
- **Draw what is visible.** A 1.5-pixel stroke through 10,000 points takes Skia
  7.3 ms, a 1-pixel one 0.4 ms; a waveform needs a point or two per pixel
  column (its minimum and maximum), not fifteen. Path commands themselves are
  cheap: they reach native code in one call.
- **Animate how things look, not where they are.** Opacity and colors are
  drawn again without layout; a view that only paints a background costs
  nothing more with opacity. Assigning a value a style already has costs
  nothing.
- **Animate nodes, not React trees.** Setting `node.style.opacity` on 500 nodes
  through refs: 2.0 ms of JavaScript. Re-rendering 500 React elements to do
  it: 4.3 ms.

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
plugin. Hermes is fetched at a pinned revision and built once per machine into
Soundor's cache (several minutes, the first time); no extra developer installs
are needed. Every Soundor symbol is mangled into the plugin's own ABI
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

## UI animations

The runtime implements native timing, springs, keyframes, composition, repetition,
opacity, ordered transforms and paint animations through
`soundor:ui` and `Animated.View` in `@soundor/react`. See the
[native animation contract](native/README.md#native-timing-animations) for playback,
presentation, caching and reduced-motion behavior. Animation execution stays on
the existing UI tick, independent of Hermes and the audio thread.
