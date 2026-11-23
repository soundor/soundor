---
title: 'VST3 runtime'
description: 'VST3 plugins for Linux, macOS and Windows: a prebuilt VST3 adapter, the Soundor engine and your Rust crate, linked by Cargo and the system linker.'
---

Source: [`runtimes/vst3-runtime/`](https://github.com/soundor/soundor/tree/main/runtimes/vst3-runtime).

`@soundor/vst3-runtime` builds a project as a **VST3 plugin for Linux,
macOS or Windows**: the UI in `src/`, the [Rust processor](/docs/rust-processor)
and [controller](/docs/rust-controller) in `lib/`, the contract in
`soundor.config.ts`, the same project the [web runtime](/docs/web-runtime)
runs in a browser. No C++ is compiled when a plugin is built: the plugin is
linked from parts built once.

```ts
// soundor.config.ts
import { defineSoundorConfig } from '@soundor/config';
import { vst3Runtime } from '@soundor/vst3-runtime';

export default defineSoundorConfig({
  plugin: { id: 'com.acme.reverb', name: 'Acme Reverb' },
  runtimes: [vst3Runtime()],
  parameters: {
    gain: { type: 'float32', label: 'Gain', min: 0, max: 1, default: 0.5 },
  },
});
```

```sh
pnpm add -D @soundor/vst3-runtime @soundor/vst3-host
soundor build vst3           # .soundor/dist/vst3/Acme Reverb.vst3 (for this machine)
soundor build vst3 --debug   # a Debug build with DevTools
soundor dev vst3             # opens the Debug build in the VST3 host
```

A project lists it beside the web runtime, as every
[example](https://github.com/soundor/soundor/tree/main/examples) does
(`pnpm --filter controller build:vst3`). In Soundor's own repository, build
the runtime's prebuilt adapter first, which an installed package downloads
instead: `pnpm --filter @soundor/vst3-runtime build:native`.

## Requirements

Each platform builds its own plugins: there is no cross-compilation, and
there are no builds for other platforms and architectures (Linux on ARM,
Windows on ARM).

| Platform                      | Builds                                         | Plugins run on              |
| ----------------------------- | ---------------------------------------------- | --------------------------- |
| Linux x86_64                  | `Contents/x86_64-linux/<Name>.so`              | Linux x86_64 with glibc     |
| macOS, Apple silicon or Intel | `Contents/MacOS/<Name>`, for the machine's CPU | macOS 12 or later, that CPU |
| Windows x64                   | `Contents/x86_64-win/<Name>.vst3`              | Windows x64                 |

Everywhere:

- **Node** and **Rust** (stable, with Cargo).
- **`@soundor/vst3-host`**, a required peer dependency.

On **Linux**:

- **A C++ compiler driver**, `c++` (g++ or clang++), or the one `CXX` names:
  it links the plugin, with its C++ runtime linked statically. Rust needs a C
  compiler to link on Linux anyway. Debian and Ubuntu: `sudo apt install
  build-essential`; Fedora: `sudo dnf install gcc-c++ libstdc++-static`.
  `LDFLAGS` is passed on (`-fuse-ld=lld`, say).
- At run time, what every Soundor plugin on Linux uses: glibc, fontconfig,
  FreeType and GIO, which desktop systems have; X11 and the GPU's libraries
  are loaded when the editor opens, and libcurl (`libcurl.so.4`) when the UI
  first calls `fetch()`: the system's HTTP stack, never one in the plugin.
- **For the editor**, a host that offers its run loop (`Linux::IRunLoop`)
  through the editor's `IPlugFrame`, as the VST3 specification asks of every
  Linux host, and an X server with XInput 2 (X.Org 1.7 or later, and
  XWayland). There is no fallback: without the run loop the editor does not
  open, and without XInput 2 it shows the UI but takes no input (the log says
  why). Audio, parameters and state work either way. Opening the editor
  during development needs an X11 or XWayland display.

On **macOS**:

- **Apple's Command Line Tools** (`xcode-select --install`), which Rust
  needs too: `c++` (or `CXX`) links the plugin as a bundle, and `codesign`
  signs it, with [the project's identity](/docs/cli/config#signing) or
  ad hoc. `LDFLAGS` is passed on.
- The plugin is built for the machine's architecture (arm64 on Apple
  silicon), for macOS 12 or later: the engine's minimum.

On **Windows**:

- **Visual Studio 2022 (17.14) or later, or its Build Tools**, with
  "Desktop development with C++", which Rust needs too: its `link.exe` links
  the plugin, found with `vswhere` (or the developer prompt's), and a
  **Windows SDK** (Windows 11 or 10; part of that workload by default, but it
  can be unticked), whose libraries every plugin links. Rust's
  `x86_64-pc-windows-msvc` toolchain, the default there. Nothing is compiled
  in the default mode: these only link.
- Plugins link the static C runtime: users need no Visual C++
  Redistributable.

`soundor doctor` checks the platform, Rust, the linker (on Windows also the
Windows SDK and the static C runtimes it links, on Linux the static C++
runtime and libcurl) and the prebuilt adapters, or in source mode CMake and
Ninja.

## Options

| Option      | Default                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| `classIds`  | derived from `plugin.id`: `{ processor, controller }`, 32 hexadecimal digits each, to keep a released identity |
| `engine`    | `{ mode: 'prebuilt' }`: the engine and the adapter from their releases; `{ mode: 'source' }`: built here       |
| `timeLimit` | `5000`: milliseconds one call into the UI's JavaScript may run; `false`: none                                  |

### Building the engine and the adapter from source

```ts
vst3Runtime({ engine: { mode: 'source' } });
```

The engine and the VST3 adapter are then compiled on your machine from the
sources the installed packages carry, instead of being downloaded: the
engine from `@soundor/engine` (Skia, ANGLE and Hermes included), then the
adapter from `@soundor/vst3-runtime`'s `native/` against that engine.
It is for a platform or toolchain the releases don't cover, for debugging
the engine or the adapter with their sources on disk, or for building
without downloading binaries.

- **What it needs**, beyond a normal build: CMake 3.22 or later, Ninja (on
  Windows, Visual Studio 2022 or later with "Desktop development with C++"),
  a C++20 compiler and network access for the pinned dependencies' sources
  (each verified by SHA-256). `soundor doctor` checks CMake and Ninja.
- **How long:** the first build takes minutes per variant (Release, and
  Debug for `soundor dev` or `--debug`); Skia, ANGLE and Hermes are built once
  per machine. Both builds are kept in Soundor's cache
  (`engine-source/` and `vst3-adapter-source/`, under `SOUNDOR_CACHE` if
  set), per package version, and reused by every project after that.
  Deleting them builds again.
- In Soundor's own repository the engine is the workspace's, built in
  `engine/build/`, and the adapter is rebuilt incrementally on every plugin
  build, so edits to either are picked up.

The plugin's name, vendor (`plugin.vendor.name`, else the vendor part of
`plugin.id`), version, categories, buses, MIDI, editor, parameters, state and
presets come from the config, as for every runtime.

## Developing

`soundor dev vst3` opens the editor in the [Soundor VST3 host](/docs/contribute/vst3-host).
UI edits reload in the open editor. Rust edits rebuild the plugin and reopen
it in a fresh host process if it was open. Press **v** then **Enter** to
reopen the host after closing it. Quitting `soundor dev` also closes its host.

The Soundor VST3 host connects to DevTools automatically. You can also open the
bundle in another host. Start that host with `SOUNDOR_DEVTOOLS_SESSION` set
to the descriptor path printed by `soundor dev`.

## How a plugin is put together

```text
soundor.config.ts ── descriptor (JSON) ─┐
src/ ── UI bundle ── bytecode ──────────┤ generated crate ── Cargo ──> libplugin.a ─┐
lib/ (your crate) ──────────────────────┘ (+ soundor-vst3)                          │
                                                                                     ├─ the linker ──> Name.vst3
@soundor/vst3-runtime: the prebuilt adapter (its release) ─────────────────────────┤
@soundor/engine: the prebuilt engine archive (engine()) ────────────────────────────┘
```

- **The VST3 adapter** (`libsoundor_vst3.a`, `soundor_vst3.lib` on Windows,
  one per platform and variant): Steinberg's
  [VST3 SDK](https://github.com/steinbergmedia/vst3sdk) 3.8.1 and a generic
  component (`IComponent`, `IAudioProcessor`), edit controller
  (`IEditController`, `IUnitInfo`, `IMidiMapping`) and view (`IPlugView`). It
  is the same for every plugin of a runtime version, compiled once, against
  the exact engine the package depends on. The adapters are a GitHub release
  of their own (`vst3-adapters-v<version>-…`), not in the npm package: the
  package's `artifacts/manifest.json` names each archive with its URL,
  SHA-256 and size, and the first build that needs one downloads it into
  Soundor's cache (`vst3-adapters/` beside the engine's archives, under
  `SOUNDOR_CACHE` if set), checks it, and reuses it from then on. A download
  or checksum failure fails the build; nothing is built instead.
- **The plugin's descriptor**: the config as JSON (identity and class ids,
  buses and layouts, MIDI, editor, parameters with their behaviour as
  [expressions](/docs/contribute/expression), state, presets, streams). The
  adapter reads it when the plugin loads.
- **The Rust side**: Cargo builds one static library from a crate the runtime
  generates in `.soundor/cache/vst3/`: your `lib/` crate as a dependency,
  unchanged, and the runtime's `soundor-vst3` crate, which embeds the
  descriptor and the UI. Your processor and controller run through
  `soundor::export!`, exactly as in the web runtime.
- **The engine**: the prebuilt engine of `@soundor/engine`, the exact version
  this package depends on, resolved through npm from this package (never
  from whatever copy the workspace root happens to hold), downloaded once into
  Soundor's cache and verified (see [Soundor Engine](/docs/engine)).
- **The CLI** bundles the UI, lowers it with the engine's own lowering,
  compiles it to Hermes bytecode with the engine's `hermesc` (release builds),
  generates the crate, runs Cargo, links (`c++` on Linux and macOS,
  `link.exe` on Windows), lays out the bundle and, on macOS, signs it.

## The bundle

```text
Acme Reverb.vst3/
  Contents/
    x86_64-linux/Acme Reverb.so      Linux
    MacOS/Acme Reverb                macOS, with Info.plist and PkgInfo
    x86_64-win/Acme Reverb.vst3      Windows
    Resources/
      moduleinfo.json
      licenses/           the notices of everything inside: VST3 SDK, engine, Skia, Hermes...
```

The binary needs nothing beside it: the UI is embedded. It exports only
VST3's three entry points (`GetPluginFactory`, and `ModuleEntry` and
`ModuleExit` on Linux, `bundleEntry` and `bundleExit` on macOS, `InitDll`
and `ExitDll` on Windows); everything else (the SDK, the engine, Rust's
standard library, the C++ runtime) is hidden, so any number of Soundor
plugins, of any versions, share a host. A macOS bundle is signed as the last
step of the build; notarizing it is yours (see
[Signing and distributing on macOS](#signing-and-distributing-on-macos)).

**Identity.** Hosts know a plugin by its class ids, not by its file name: they
are derived from `plugin.id` (a hash), so they stay the same across versions
and rebuilds, and renaming the bundle keeps the plugin. They are the same on
every platform, as hosts write them (`moduleinfo.json`), so a project made on
one opens the plugin on another. Changing `plugin.id` makes another plugin. A parameter's VST3 id is a hash of its id in the config
(as JUCE's VST3 wrapper derives it), so renaming a parameter's key breaks automation that
hosts recorded for it.

**Installing.** Copy or link the bundle where hosts look, then rescan in the
host:

| Platform | One user                        | Everyone                             |
| -------- | ------------------------------- | ------------------------------------ |
| Linux    | `~/.vst3`                       | `/usr/lib/vst3`                      |
| macOS    | `~/Library/Audio/Plug-Ins/VST3` | `/Library/Audio/Plug-Ins/VST3`       |
| Windows  | —                               | `C:\Program Files\Common Files\VST3` |

```sh
mkdir -p ~/.vst3 && ln -sfn "$PWD/.soundor/dist/vst3/Acme Reverb.vst3" ~/.vst3/
```

## Behaviour

- **Audio.** Your processor gets the host's buffers in place (inputs copied
  into the outputs' channels first), 32-bit only, in blocks no longer than
  the host set up; the config's layouts are what `setBusArrangements`
  accepts. Processing takes no lock and allocates nothing.
- **Parameters.** Each parameter's mapping, steps and text are the config's,
  interpreted from its expressions with the same semantics as the
  expression language's C++ and the web runtime's JavaScript (checked against
  the expression language's corpus, bit for bit). Hosts' text works with the
  editor closed. A block uses each parameter's last value in it, as JUCE's
  VST3 wrapper does. `readOnly` parameters are output parameters the
  processor publishes; `role: 'bypass'` is VST3's bypass parameter;
  parameter groups are VST3 units.
- **Native events.** The Rust controller publishes [typed events](/docs/api/native#events) to open editors.
- **MIDI.** Note on, note off and polyphonic pressure as VST3 events, control
  changes, pitch bend, channel pressure and program change through
  `IMidiMapping` (hidden parameters) and legacy MIDI CC output, at their sample
  offsets. See [MIDI](/docs/midi).
- **State.** The component's state is the plugin's whole state
  (`{"version":1,"parameters":{...},"state":{...}}`), so a
  saved project restores parameters and [persistent state](/docs/api/state).
  State the UI or the controller changes reaches the processor as a message,
  so it works when a host runs the component and the controller apart, and
  marks the host's project modified. After a restore, the host is told to
  read the parameters back (`restartComponent`).
- **Presets.** [Factory presets](/docs/api/presets) are the root unit's
  program list, so a host's program selector loads them too, and shows the
  one the UI, the controller or History selected.
- **Host state.** [`soundor:host`](/docs/api/host) reports the application
  name and any channel metadata the host supplies to the controller. With a
  processor in the same process, the editor also sees the processing mode and
  transport, including loop bounds and SMPTE timecode when reported.
- **Clipboard.** Text fields and `soundor:ui` share the system clipboard
  with other applications (on Linux, under X11 and XWayland).
- **The editor.** A child of the host's view (an X11 window on Linux, an
  NSView on macOS, an HWND on Windows), in which the engine runs your UI:
  GPU composition where there is a GPU (through
  ANGLE: Vulkan, Metal, Direct3D 11), CPU otherwise, Soundor's own input (XInput 2,
  AppKit, Win32) and accessibility (AT-SPI, VoiceOver, UI Automation). It
  resizes within the config's limits (`editor`), and follows the host's
  content scale (Linux, Windows) or the screen's (macOS). On macOS and
  Windows it runs on a timer of the host's UI thread, as the Rust
  controller's scheduled work does, editor closed or not.
- **`fetch()`** goes through the system's HTTP stack: `NSURLSession` on
  macOS, WinHTTP on Windows, and on Linux libcurl, loaded when first used
  (`libcurl.so.4`, else `libcurl-gnutls.so.4`), with the system's
  certificates and proxies, and HTTP/3 where that libcurl has it. Fedora and
  Ubuntu desktops install it; where there is none, `fetch()` rejects, saying
  so.
- **Storage.** `soundor:storage` and `soundor:fs` keep their files in
  `<data>/Soundor/<plugin id>`, `<data>` being `$XDG_CONFIG_HOME` (or
  `~/.config`), `~/Library` or `%APPDATA%`.
- **Pointer lock** (`requestPointerLock()`) hides the pointer and keeps it in
  the view, moving it back to where the lock began whenever it strays. Under Wayland (XWayland), moving the
  pointer back is the compositor's to allow.
- **DevTools.** A Debug build (`soundor build vst3 --debug`, `soundor dev
  vst3`) connects to the DevTools session the environment variable
  `SOUNDOR_DEVTOOLS_SESSION` names.
- **Instances.** Every instance is independent. When the component and the
  controller share a process, the controller also reaches the processor's
  memory: the Rust controller's audio resources, `soundor:midi` from the UI
  and native streams. Hosts load both in one process, even when they sandbox
  plugins, and JUCE plugins rely on it as well; a host that ran them apart
  would still get everything else.

## The plugin's JavaScript runtime

Each open editor has its own runtime: Hermes (interpreted, no JIT) on the
host's UI thread, ticked at 60 Hz to deliver parameter changes and run
pending jobs. No JavaScript runs on the audio thread. Closing the editor
destroys its runtime; opening it again starts a fresh one.

A release build embeds the UI bundle compiled to Hermes bytecode by the
`hermesc` of the engine's own Hermes, and links the VM without its compiler.
The bytecode keeps line and column numbers, so stack traces point at lines,
but not source text: a function's `toString()` cannot return its code. A
Debug build (`soundor dev`, `--debug`) runs the bundle from source, with the
compiler linked, but JavaScript compiles none in either: `eval()` and
`new Function()` throw, so a dependency that generates code at run time (a
schema validator compiling its checks, a template engine) needs its
build-time form, and this shows up in development rather than in the built
plugin. The CLI's bundle is lowered with the engine's own lowering (a
CommonJS module function, with the syntax Hermes lacks lowered); see
[the module reference](/docs/contribute/engine-reference#modules) for what
that changes, and [the engine](/docs/contribute/engine-reference#the-javascript-engine)
for the language.

### Canvases: 2D and WebGL

A canvas node draws with `getContext('2d')`, which uses Skia (on the GPU
where there is one, otherwise on the CPU), or with `getContext('webgl2')`,
which uses ANGLE on the GPU. WebGL needs a hardware GPU. Where there is none
(a VM, a headless Linux machine), `getContext('webgl2')` returns null and
the plugin log says why, so code should fall back. Three.js's
`WebGLRenderer` runs on it unmodified. The GPU compositor shows WebGL as it
is, without copies; with the CPU compositor, WebGL is read back.

Retained UI layers and Canvas 2D use Skia Ganesh on the same ANGLE device as
WebGL and the compositor. `getImageData()` reads pixels back;
`putImageData()` uploads them. If a GPU reset loses a 2D canvas, its
contents and context state reset; the plugin's code must draw it again.
`SOUNDOR_RENDERER=cpu` keeps drawing and presentation on the CPU. In a Debug
build, `SOUNDOR_SHOW_RENDERER=1` shows a small, input-transparent badge with
the active compositor: **GPU composition** or **CPU composition**.

### Performance: what a frame costs

The UI's JavaScript runs in an interpreter (Hermes, with no JIT: plugin hosts
do not all allow one), on the host's UI thread, so a slow frame also stalls
the host's own UI. Layout, drawing and compositing are native and cheap;
what costs is JavaScript run every frame. Measured with
[`tools/benchmark`](/docs/contribute/benchmark) (Linux, an RTX 4050), per
frame:

- **Give per-frame work to the GPU.** 200,000 points moved by JavaScript: 28
  ms. The same points moved by the vertex shader, JavaScript setting one
  `time` uniform: 0.1 ms.
- **Compute natively.** FFTs, peaks, envelopes belong in the
  [Rust controller](/docs/rust-controller) or the processor (its
  [streams](/docs/api/native#streams)); JavaScript draws the result.
- **Draw what is visible.** A 1.5-pixel stroke through 10,000 points takes Skia
  7.3 ms, a 1-pixel one 0.4 ms; a waveform needs a point or two per pixel
  column (its minimum and maximum), not fifteen. Path commands themselves are
  cheap: they reach native code in one call.
- **Animate how things look, not where they are.** Opacity and colors are
  drawn again without layout. Assigning a value a style already has costs
  nothing.
- **Animate nodes, not React trees.** Setting `node.style.opacity` on 500 nodes
  through refs: 2.0 ms of JavaScript. Re-rendering 500 React elements to do
  it: 4.3 ms. Native animations (`Animated.View`, see the
  [native animation contract](/docs/contribute/engine-reference#native-timing-animations))
  run on the UI tick without JavaScript.

### Memory: what an editor costs

A plugin with its editor closed costs little: the processor, the controller
and the plugin's code. Opening the editor adds its own JavaScript runtime,
UI tree, fonts, the surfaces it draws into, and a GPU context with its driver
memory. Closing it gives all of that back. Measured with the
[end-to-end suite](/docs/contribute/e2e-suite)'s plugin (a Debug build,
Linux, Vulkan), an open editor adds about 23 MB to the host's PSS (10 MB of
it heap) and 12 threads. Opening and closing it 15 times leaves 2 to 3 MB of
heap behind (allocator and driver noise) and no threads.

- **Editors share what they can.** The editors open on one thread share one
  GPU device and its ANGLE display, whose worker pool has at most two
  threads. The fonts
  share their font manager, and one typeface for each font file. A second
  open editor costs its runtime, UI and surfaces, not another device.
- **Window size costs memory.** The UI is drawn into surfaces of its size in
  device pixels, 4 bytes a pixel: at 1600×1200 that is 7.7 MB for one full
  layer, and canvases and animated groups have layers of their own.
- **2D canvases cache on the GPU.** Each editor's GPU-drawn canvases keep up
  to 32 MB of textures for later (path masks, glyph atlases, scratch
  surfaces). What goes unused for 10 seconds is freed.

The suite checks that repeated opens leave nothing behind
(`e2e/vst3/memory.test.ts`).

### Accessibility

The view is accessible to screen readers through Soundor's own semantics
(the accessibility props of `@soundor/react`): AT-SPI over the system's GIO
on Linux (`libgio-2.0.so.0`), UI Automation on Windows, NSAccessibility on
macOS. See [native accessibility](/docs/contribute/engine-reference#accessibility),
and the [Linux](/docs/contribute/linux-accessibility) and
[Windows](/docs/contribute/windows-accessibility) notes.

## Limitations

- Linux x86_64, macOS and Windows x64, each building for itself; no AU,
  CLAP or standalone. macOS plugins are for the building machine's CPU, not
  universal.
- On Linux, the Rust controller's scheduled work runs while an editor is
  open, or with a host that lends its run loop to the controller.
- Dynamic latency (`mode: 'dynamic'`) is reported as zero. Dynamic tail
  reports come from the [Rust processor](/docs/rust-processor#reporting-the-effect-tail-in-vst3).

## Validating a plugin

[pluginval](https://github.com/Tracktion/pluginval) is not part of the
runtime; run it yourself (CI runs it at its strictest level on every change
to the runtime):

```sh
curl -fsSLO https://github.com/Tracktion/pluginval/releases/download/v1.0.4/pluginval_Linux.zip
unzip pluginval_Linux.zip
./pluginval --strictness-level 10 --validate-in-process --validate ".soundor/dist/vst3/Acme Reverb.vst3"
```

On macOS and Windows, take `pluginval_macOS.zip` (`pluginval.app/Contents/MacOS/pluginval`)
or `pluginval_Windows.zip` (`pluginval.exe`). On Linux without a display,
run it under `xvfb-run -a` for its editor tests.

Internals: [the VST3 runtime's architecture](/docs/contribute/vst3-runtime).

## Signing and distributing on macOS

`soundor build vst3` signs the bundle with the identity resolved from
`SOUNDOR_MACOS_SIGNING_IDENTITY`, then the config's
[`signing.macos.identity`](/docs/cli/config#signing), then ad hoc, as the
last step of every build (`soundor dev`'s too), and verifies the signature
(`codesign --verify --deep --strict`), so a broken one fails the build rather
than a host's plugin scan.

- **Ad hoc** (the default) is enough to use the plugin on the Mac that built
  it. No Apple account is involved.
- **To distribute** it, sign with a _Developer ID Application_ certificate
  from a paid Apple Developer account. With a real identity Soundor adds the
  hardened runtime and a secure timestamp, which notarization requires:

  ```sh
  SOUNDOR_MACOS_SIGNING_IDENTITY="Developer ID Application: Acme (ABCDE12345)" soundor build vst3
  ```

  In CI, import the certificate into a keychain first (for example with
  `Apple-Actions/import-codesign-certs`); set `SOUNDOR_MACOS_KEYCHAIN` if the
  step does not add that keychain to the search list.

- **Where to set the identity:** usually only as
  `SOUNDOR_MACOS_SIGNING_IDENTITY` in the release CI job. Put it in
  `signing.macos.identity` only if everyone who runs `soundor build` has the
  certificate and its private key: otherwise their build fails at the signing
  step.

Notarization is yours to run on what you ship; downloaded files are
quarantined, and Gatekeeper blocks plugins Apple has not notarized. For a
bundle shipped in a zip:

```sh
cd .soundor/dist/vst3
ditto -c -k --keepParent "Acme Reverb.vst3" AcmeReverb.zip
xcrun notarytool submit AcmeReverb.zip --keychain-profile <profile> --wait
xcrun stapler staple "Acme Reverb.vst3"   # then zip the stapled bundle to ship
xcrun stapler validate "Acme Reverb.vst3"
```

`<profile>` is stored once with `xcrun notarytool store-credentials`; in CI,
pass `--key`, `--key-id` and `--issuer` (an App Store Connect API key)
instead.
