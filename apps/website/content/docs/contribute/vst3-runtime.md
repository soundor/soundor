---
title: 'VST3 runtime internals'
description: 'The prebuilt VST3 adapter, its private ABI with the plugin Rust side, threads, ownership, linking, versions, builds and tests.'
---

Source: [`runtimes/vst3-runtime/`](https://github.com/soundor/soundor/tree/main/runtimes/vst3-runtime).
User guide: [VST3 runtime](/docs/vst3-runtime).

## Purpose

A VST3 runtime for Linux, macOS and Windows in which nothing is
compiled per plugin: a generic C++ adapter is prebuilt once per platform and
engine variant and released beside the npm package, and each plugin is its Rust crate and that adapter, linked with
the prebuilt engine. What makes a plugin itself is data, read at run time.

## Where the code is

| Path                                                               | What                                                                                                                                          |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `native/include/soundor/vst3/PluginAbi.h`                          | The private C ABI the adapter asks of the plugin                                                                                              |
| `native/src/Factory.cpp`                                           | `GetPluginFactory`: the two classes, described from the descriptor                                                                            |
| `native/src/Processor.*`                                           | The component (`AudioEffect`): buses, processing, MIDI, state                                                                                 |
| `native/src/Controller.*`                                          | The edit controller (`EditControllerEx1`, `IMidiMapping`): parameters, state store, History, presets, the Rust controller                     |
| `native/src/Editor.*`                                              | The view (`IPlugView`): its window and run loop, the engine's `editor::Editor`                                                                |
| `native/src/NativeWindow*`, `X11.*`, `Timer*`                      | The view's window per platform (X11, NSView, HWND) with its CPU frames, and the UI thread's timer on macOS and Windows                        |
| `native/src/Descriptor.*`                                          | The descriptor, parsed once per module (with the engine's `soundor::json`)                                                                    |
| `native/src/Expression.*`                                          | The expression interpreter; `generated/ExpressionRuntime.h` is the C++ compiler's helpers (`pnpm gen:expression`)                             |
| `native/src/State*.*`, `Presets.*`, `ParameterHost.*`, `Modules.*` | Persistent state, documents, presets, History-aware parameter edits, the generic `soundor:state`, `soundor:presets`, `soundor:native` modules |
| `native/src/Link.*`                                                | What a controller shares with its processor in one process, and the native streams                                                            |
| `native/cmake/Vst3Sdk.cmake`                                       | The SDK, pinned like `@soundor/vst3-host`'s (3.8.1 build 84, SHA-256 verified)                                                                |
| `rust/`                                                            | `soundor-vst3`: the ABI's Rust side and `soundor_vst3::plugin!`                                                                               |
| `src/`                                                             | The runtime: descriptor, generated crate, UI preparation, link, bundle, doctor                                                                |
| `scripts/adapter.ts`                                               | Builds and stages the prebuilt adapter, runs the native tests and clang-tidy                                                                  |
| `tests/`                                                           | The test plugin, its tests in the VST3 host, the expression corpus                                                                            |

## How it works

### Responsibilities

- **The adapter** translates VST3 into Soundor and back. It hosts the
  plugin's processor, controller and MIDI through the engine's
  `processor::RustProcessor`, `processor::RustController` and `midi::Host`,
  so the processor's and controller's ABI is `soundor::export!`'s
  (`RustProcessorAbi.h`, `RustControllerAbi.h`, `midi/Midi.h`), as in the web
  runtime. What could be generated per plugin (the parameters' behaviour,
  `soundor:state`, `soundor:presets`, the controller's `soundor:native`) is
  written once here and driven by the descriptor.
- **The Rust runtime** (`soundor-vst3`) implements the adapter's private ABI:
  which plugin it is.
- **The user's crate** is the processor and controller, as for every runtime.
- **The engine** is everything about the UI (JavaScript, layout, rendering,
  input, accessibility); the editor only gives it a window and a run loop.
- **The CLI runtime** writes the descriptor and the crate, runs Cargo and the
  linker, and lays out the bundle.

### The private ABI

One function, defined by `soundor_vst3::plugin!` in the generated crate:

```c
int32_t soundor_vst3_plugin(SoundorVst3Plugin* plugin);
```

It fills the descriptor (JSON), the controller descriptor
(`describeController()`'s bytes, checked by `RustController`), the embedded UI
files (16-byte aligned: Hermes reads bytecode in place), or a development
build's UI directory and log file.

- **Versions.** The structure starts with its size and
  `SOUNDOR_VST3_ABI_VERSION`; the adapter refuses another version, and a
  descriptor of another `format`, saying why in the log; the plugin then has
  no classes. The runtime package, its adapter and its crate are one
  version: the generated crate depends on the package's own `rust/`.
- **Ownership.** Everything returned is static, owned by the Rust side and
  valid while the module is loaded; the adapter copies what it keeps and
  frees nothing.
- **Errors.** Nothing in it can panic; a too small structure returns 1.
  Processor and controller calls keep `soundor::export!`'s rules: a panic
  becomes a status, a C++ exception in a controller callback a failure.
- **Threads.** Any thread, any number of times; the adapter calls it once per
  module (`plugin()`, under `std::call_once`).

### Threads and lifecycles

- **Component**: `initialize`, bus setup, `setupProcessing`, `setActive`
  (which prepares the Rust processor), `getState`/`setState` and messages on
  the host's control thread; `process` and `setProcessing` on the audio
  thread. `process` takes no lock and allocates nothing: parameter values are
  atomics, the state's audio snapshot is `processor::AudioState`'s triple
  buffer, MIDI goes through preallocated arrays, streams are the engine's
  lock-free slots.
- **Controller and editor**: the host's UI thread, which is the Rust
  controller's control thread; only its `wake()` comes from other threads (an
  atomic flag). It is pumped by the editor's 60 Hz timer, and by one of its
  own: on Linux on the host's `IRunLoop` when the host context offers one;
  on macOS and Windows, where hosts lend none, always (`Timer`: a
  `CFRunLoopTimer` in the main run loop's common modes, a message-only
  window's `WM_TIMER`).
- **Component and controller never assume they share a process.** The
  component's state is the whole state; the controller learns it through
  `setComponentState`, and sends every state change back (message
  `soundor.state`, the values as JSON). The component sends `soundor.link`,
  a token only this module resolves: when the controller does, it gets a
  `Link` (shared pointers to the `RustProcessor`, the streams and the host
  state), so the processor outlives the Rust controller that publishes to it,
  whichever the host destroys first. The component is still not declared
  `kDistributable` (factory and `moduleinfo.json`), as JUCE's VST3 plugins are
  not: what
  needs one process would be lost, so hosts are not invited to split them.
- **What the host is told.** A state change is `setDirty(true)` (parameters
  speak for themselves); a restore ends with
  `restartComponent(kParamValuesChanged)`; a selected factory preset moves the
  program list's parameter (`beginEdit`, `performEdit`, `endEdit`), unless
  the host chose it.
- **The editor** owns a native window (`NativeWindow`) and the engine's
  `editor::Editor`: the runtime
  (`DevSession` in development), placing the UI, the compositor, native
  input, the pointer lock, the cursor, accessibility and, in Debug builds,
  DevTools. The editor is its `editor::Platform`: the window's size, content
  scale and screen position, the host's focus, the cursor, sizes held to the
  config's limits and asked of the host (`resizeView()`), and the run loop
  (the engine's Editor's 60 Hz frame and, on Linux, the input's
  descriptor). It gives the runtime `platform::systemHttpClient()` for
  `fetch()`. The window per platform:
  - **Linux** (`X11EmbedWindowID`): an X11 child window on a connection of
    its own; CPU frames with `XPutImage`. Xlib is loaded with `dlopen`, as
    the engine does, and its headers stay in `X11.cpp`.
  - **macOS** (`NSView`): a plain layer-backed NSView in the host's (no
    Objective-C class is added); CPU frames are a sublayer's contents (a
    `CGImage` of the bitmap). Sizes are in points: the pixel density is the
    window's backing scale, and `setContentScaleFactor()` is refused. The
    cursor is set while the pointer is over the view, every frame.
  - **Windows** (`HWND`): a child window of the system's `STATIC` class,
    subclassed (nothing registered, as the engine's own child windows):
    `WM_NCHITTEST` makes it take the pointer, `WM_PAINT` paints the CPU
    frames (`SetDIBitsToDevice`), `WM_SETCURSOR` the cursor.

  On Linux the run loop and XInput 2 are requirements, with no fallback:
  `attached()` refuses a frame
  without `IRunLoop` (a thread of our own, as JUCE has, would race the host's
  calls), and without XInput 2 the editor takes no input (`inputFailed()`
  logs it; core X events would only serve X servers older than 2009).

### Linking

`src/link.ts`. On Linux, by `c++`:

```text
c++ -shared -static-libstdc++ -static-libgcc -Wl,--no-undefined -Wl,--as-needed
    -Wl,--exclude-libs,<every archive but the adapter> -Wl,--version-script=exports.map
    -Wl,--whole-archive libsoundor_vst3.a -Wl,--no-whole-archive
    libsoundor_vst3_plugin.a  -Wl,--start-group <engine archives> -Wl,--end-group
    -l:libfontconfig.so.1 -l:libfreetype.so.6 -l:libgio-2.0.so.0 ... <engine flags> <Rust's>
```

The adapter is linked whole (nothing references its classes); the Rust
library then resolves what the adapter asks (`soundor_vst3_plugin`,
`soundor_processor_*`, `soundor_controller_*`, `soundor_midi_*`), and
`--no-undefined` fails the link naming any missing one. The adapter is
compiled with hidden visibility but for the SDK's entry points, every other
archive is excluded, and the version script exports exactly
`GetPluginFactory`, `ModuleEntry` and `ModuleExit`. System libraries are named
by soname, so linking needs no development packages.

On **macOS**, by `c++` too: `-bundle -arch <the machine's>
-mmacosx-version-min=<the engine's minimum>`, the adapter with `-force_load`,
`-exported_symbols_list` naming `_GetPluginFactory`, `_bundleEntry` and
`_bundleExit` (the SDK's `macexport.exp`), the engine's frameworks and the
adapter's (AppKit, QuartzCore, CoreFoundation). The engine's metadata lists
only its archives' system dependencies (Hermes's, ANGLE's); what the
engine's own code and Skia need (`SoundorPlatformLibraries.cmake`, which
CMake consumers link) is listed in `link.ts`, as on Linux. Two-level namespaces and
hosts' `RTLD_LOCAL` keep everything else apart; the build signs the bundle
last (`codesign`, `ctx.signing`). The Rust library is built for the
machine's target (`aarch64-apple-darwin` or `x86_64-apple-darwin`); the
adapter and the engine are universal.

On **Windows**, by MSVC's `link.exe`, found with `vswhere` and its
`vcvars64.bat` (or the developer prompt's `VCToolsInstallDir` and `LIB`),
from a response file: `/DLL`, `/WHOLEARCHIVE:` the adapter, whose
`SMTG_EXPORT_SYMBOL`s (`__declspec(dllexport)`) are the only exports. The
system libraries are listed in `link.ts` (WinHTTP, UI Automation, IMM,
DirectWrite and the rest of `SoundorPlatformLibraries.cmake`'s).
Everything links the static C runtime: the adapter and the engine's `-static`
archives (`/MT`, `/MTd`), Rust with `+crt-static`; Rust's standard library
names the release runtime in Debug builds too, so they drop it
(`/NODEFAULTLIB`). CI compiles the adapter with the MSVC toolset Release pins
(`v143`, 14.44), so authors' later `link.exe` read it.

### The adapter and the engine

The adapter is compiled against an engine archive
(`SOUNDOR_ENGINE_PREBUILT_<VARIANT>_DIR`, as `engine({ target, variant })`
gives it) and the engine's internal binding headers
(`soundor::runtime_internal`). Debug and release engines differ (DevTools,
Hermes's compiler), so there is one adapter per target and variant:
`prebuilt/<target>-<variant>/` (`linux-x64`; `macos-universal`, arm64 and
x86_64 for the engine's minimum macOS; `windows-x64`, against the `-static`
engines), with `adapter.json` naming the engine
version and source fingerprint it was built against. A build refuses an
adapter of another engine. The package depends on the exact engine version.

### Releasing the adapters

They are released as the engine's archives are, and found by the same
cache (`src/adapter.ts`, over `@soundor/engine/archives`):

- **The release.** `vst3-adapters-v<version>-<short sha>-r<revision>` on
  GitHub: the six archives
  (`soundor-vst3-adapter-<version>-<target>-<variant>.tar.gz`, each
  `prebuilt/<target>-<variant>/` packed deterministically),
  `build-info.json` and `SHA256SUMS`. `.github/scripts/vst3-adapters.mjs`
  packs, assembles, releases and verifies it, with the engine's release code
  (`engine-prebuilts.mjs`). A published release is never replaced: a rerun
  of the same version and commit verifies and reuses it.
- **The package** carries `artifacts/manifest.json` (written by the release
  workflow from the verified public release, never committed) and no
  adapter: each archive's URL, SHA-256 and size, and the engine it was built
  against.
- **A build** in an installed package takes its target's and variant's
  archive from the manifest, downloads it once into
  `<cache>/vst3-adapters/<sha256>/`, checks it and its `adapter.json`
  (runtime version, target, variant, engine), and links it. In Soundor's
  workspace (where `native/` exists) it uses `prebuilt/` instead.
  `SOUNDOR_VST3_ADAPTER_MANIFEST` names another manifest for either: for
  example one of archives on disk (`vst3-adapters.mjs local-manifest`), to
  build plugins with CI's archives before they are released.

## Invariants and tests

- No plugin-specific C++; no plugin framework; the engine's own input, pointer lock,
  rendering, accessibility, HTTP and DevTools bridge, unchanged.
- The interpreter computes what the expression compilers compute:
  `native/tests/AdapterTests.cpp` evaluates `@soundor/expression`'s
  differential corpus (`native/tests/generated/expression-corpus.json`, from
  `src/expression-corpus.test.ts`) and compares bits.
- The descriptor the native tests read is `descriptor.ts`'s
  (`src/test-descriptor.test.ts`, `UPDATE_GOLDEN=1`).
- `tests/plugin.test.ts` builds nothing; after `pnpm test:plugin` builds the
  test plugin it checks, in the VST3 host: classes and buses, parameters and
  their text, audio and automation, the published parameter, MIDI in and
  out, state round trips in a new instance (and the restart after one), refused
  state, presets from the program list, the class flags, the project marked
  modified and the program selector following the UI (with a display), independent instances, the three exported symbols (Linux, macOS), the editor
  (open, resize within limits, close, twice; on Linux it needs a display),
  and on Linux `Instances.cpp`: four instances of two builds of the plugin in
  one process.
- CI (`.github/workflows/vst3.yml`) builds both adapters against the engine
  Verify selected, on Linux, macOS and Windows, runs the native tests and the
  plugin tests (on Linux under Xvfb, with clang-tidy and the Rust crate's
  checks), builds the controller example, and runs pinned pluginval (checked
  by SHA-256) at strictness 10 on both plugins. macOS checks the plugin's
  minimum macOS, Windows its imports (no C runtime DLL) and exports. Release
  builds the adapters in the same workflow, against the engine to be
  published, packs each target's as release archives, releases all six once
  every check has passed (`vst3-release`), and writes the package's manifest
  from that release (`pack`).

## How to change it

```sh
pnpm --filter @soundor/vst3-runtime build:native      # both adapters → prebuilt/
pnpm --filter @soundor/vst3-runtime test:native       # native unit tests
pnpm --filter @soundor/vst3-runtime lint:native       # clang-tidy
pnpm --filter @soundor/vst3-runtime test              # unit tests
xvfb-run -a pnpm --filter @soundor/vst3-runtime test:plugin
pnpm --filter @soundor/vst3-runtime gen:expression    # after @soundor/expression changes
```

Rebuild the adapter after changing the engine: a workspace engine whose
sources differ from its release is built locally by `engine()`, and the
adapter must follow it. A change to the private ABI bumps
`SOUNDOR_VST3_ABI_VERSION` on both sides; a change to the descriptor's shape
bumps `DESCRIPTOR_FORMAT` and `descriptorFormat` together.
