---
title: 'VST3 runtime'
description: 'VST3 plugins for Linux, macOS and Windows without JUCE: a prebuilt VST3 adapter, the Soundor engine and your Rust crate, linked by Cargo and the system linker.'
---

Source: [`runtimes/vst3-runtime/`](https://github.com/soundor/soundor/tree/main/runtimes/vst3-runtime).

`@soundor/vst3-runtime` builds a project as a **VST3 plugin for Linux,
macOS or Windows, without JUCE**. The same project as the [JUCE runtime](/docs/juce-runtime)'s,
unchanged: the UI in `src/`, the [Rust processor](/docs/rust-processor) and
[controller](/docs/rust-controller) in `lib/`, the contract in
`soundor.config.ts`. No C++ is compiled when a plugin is built: the plugin is
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

A project can list it beside the JUCE and web runtimes;
[`examples/controller`](https://github.com/soundor/soundor/tree/main/examples/controller)
does (`pnpm --filter controller build:vst3`).

## Requirements

Each platform builds its own plugins: there is no cross-compilation. On
other platforms and architectures (Linux on ARM, Windows on ARM), use the
JUCE runtime.

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
  the plugin, found with `vswhere` (or the developer prompt's). Rust's
  `x86_64-pc-windows-msvc` toolchain, the default there.
- Plugins link the static C runtime: users need no Visual C++
  Redistributable.

`soundor doctor` checks the platform, Rust, the linker (and on Linux the
static C++ runtime and libcurl) and the prebuilt adapters.

## Options

| Option      | Default                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| `classIds`  | derived from `plugin.id`: `{ processor, controller }`, 32 hexadecimal digits each, to keep a released identity |
| `timeLimit` | `5000`: milliseconds one call into the UI's JavaScript may run; `false`: none (as the JUCE runtime's)          |

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
@soundor/vst3-runtime: prebuilt/<target>-<variant>/lib/libsoundor_vst3.a ──────────┤
@soundor/engine: the prebuilt engine archive (engine()) ────────────────────────────┘
```

- **The VST3 adapter** (`libsoundor_vst3.a`, `soundor_vst3.lib` on Windows,
  in the package for each platform): Steinberg's
  [VST3 SDK](https://github.com/steinbergmedia/vst3sdk) 3.8.1 and a generic
  component (`IComponent`, `IAudioProcessor`), edit controller
  (`IEditController`, `IUnitInfo`, `IMidiMapping`) and view (`IPlugView`). It
  is the same for every plugin of a runtime version, compiled once, against
  the exact engine the package depends on.
- **The plugin's descriptor**: the config as JSON (identity and class ids,
  buses and layouts, MIDI, editor, parameters with their behaviour as
  [expressions](/docs/contribute/expression), state, presets, streams). The
  adapter reads it when the plugin loads.
- **The Rust side**: Cargo builds one static library from a crate the runtime
  generates in `.soundor/cache/vst3/`: your `lib/` crate as a dependency,
  unchanged, and the runtime's `soundor-vst3` crate, which embeds the
  descriptor and the UI. Your processor and controller run through
  `soundor::export!`, exactly as in the JUCE runtime.
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
step of the build, as the JUCE runtime's are; notarizing it is yours.

**Identity.** Hosts know a plugin by its class ids, not by its file name: they
are derived from `plugin.id` (a hash), so they stay the same across versions
and rebuilds, and renaming the bundle keeps the plugin. They are the same on
every platform, as hosts write them (`moduleinfo.json`), so a project made on
one opens the plugin on another. Changing `plugin.id` makes another plugin. A parameter's VST3 id is a hash of its id in the config
(as the JUCE runtime's), so renaming a parameter's key breaks automation that
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
  interpreted from its expressions with the same semantics as the JUCE
  runtime's generated C++ and the web runtime's JavaScript (checked against
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
- **State.** The component's state is the plugin's whole state, in the JUCE
  runtime's format (`{"version":1,"parameters":{...},"state":{...}}`), so a
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
  NSView on macOS, an HWND on Windows), in which the engine runs your UI as
  in the JUCE runtime: GPU composition where there is a GPU (through
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
- **Storage.** `soundor:storage` and `soundor:fs` keep their files where the
  JUCE runtime's do, so both builds of a plugin share them:
  `<data>/Soundor/<plugin id>`, `<data>` being `$XDG_CONFIG_HOME` (or
  `~/.config`), `~/Library` or `%APPDATA%`.
- **Pointer lock** (`requestPointerLock()`) hides the pointer and keeps it in
  the view as in the JUCE runtime. Under Wayland (XWayland), moving the
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
