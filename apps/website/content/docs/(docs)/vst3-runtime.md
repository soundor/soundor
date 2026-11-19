---
title: 'VST3 runtime'
description: 'Linux VST3 plugins without JUCE: a prebuilt VST3 adapter, the Soundor engine and your Rust crate, linked by Cargo and the system linker.'
---

Source: [`runtimes/vst3-runtime/`](https://github.com/soundor/soundor/tree/main/runtimes/vst3-runtime).

`@soundor/vst3-runtime` builds a project as a **Linux x86_64 VST3 plugin
without JUCE**. The same project as the [JUCE runtime](/docs/juce-runtime)'s,
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
pnpm add -D @soundor/vst3-runtime
soundor build vst3           # .soundor/dist/vst3/Acme Reverb.vst3
soundor build vst3 --debug   # a Debug build with DevTools
soundor dev vst3             # a Debug build whose UI reloads on every change
```

A project can list it beside the JUCE and web runtimes;
[`examples/controller`](https://github.com/soundor/soundor/tree/main/examples/controller)
does (`pnpm --filter controller build:vst3`).

## Requirements

- **Linux x86_64**, to build and to run. Windows, macOS, other architectures
  and cross-compilation are not supported; use the JUCE runtime there.
- **Node** and **Rust** (stable, with Cargo).
- **A C++ compiler driver**, `c++` (g++ or clang++), or the one `CXX` names:
  it links the plugin, with its C++ runtime linked statically. Rust needs a C
  compiler to link on Linux anyway. Debian and Ubuntu: `sudo apt install
  build-essential`; Fedora: `sudo dnf install gcc-c++ libstdc++-static`.
  `LDFLAGS` is passed on (`-fuse-ld=lld`, say).
- At run time, what every Soundor plugin on Linux uses: glibc, fontconfig,
  FreeType and GIO, which desktop systems have; X11 and the GPU's libraries
  are loaded when the editor opens, and libcurl (`libcurl.so.4`) when the UI
  first calls `fetch()`: the system's HTTP stack, never one in the plugin.

`soundor doctor` checks the platform, Rust, the compiler driver, the static
C++ runtime, libcurl and the prebuilt adapter.

## Options

| Option      | Default                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| `classIds`  | derived from `plugin.id`: `{ processor, controller }`, 32 hexadecimal digits each, to keep a released identity |
| `timeLimit` | `5000`: milliseconds one call into the UI's JavaScript may run; `false`: none (as the JUCE runtime's)          |

The plugin's name, vendor (`plugin.vendor.name`, else the vendor part of
`plugin.id`), version, categories, buses, MIDI, editor, parameters, state and
presets come from the config, as for every runtime.

## How a plugin is put together

```text
soundor.config.ts ── descriptor (JSON) ─┐
src/ ── UI bundle ── bytecode ──────────┤ generated crate ── Cargo ──> libplugin.a ─┐
lib/ (your crate) ──────────────────────┘ (+ soundor-vst3)                          │
                                                                                     ├─ c++ -shared ─> Name.vst3
@soundor/vst3-runtime: prebuilt/linux-x64-<variant>/lib/libsoundor_vst3.a ─────────┤
@soundor/engine: the prebuilt engine archive (engine()) ────────────────────────────┘
```

- **The VST3 adapter** (`libsoundor_vst3.a`, in the package): Steinberg's
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
  generates the crate, runs Cargo, links and lays out the bundle.

## The bundle

```text
Acme Reverb.vst3/
  Contents/
    x86_64-linux/Acme Reverb.so
    Resources/
      moduleinfo.json
      licenses/           the notices of everything inside: VST3 SDK, engine, Skia, Hermes...
```

The binary needs nothing beside it: the UI is embedded. It exports only
`GetPluginFactory`, `ModuleEntry` and `ModuleExit`; everything else (the SDK,
the engine, Rust's standard library, the C++ runtime) is hidden, so any
number of Soundor plugins, of any versions, share a host.

**Identity.** Hosts know a plugin by its class ids, not by its file name: they
are derived from `plugin.id` (a hash), so they stay the same across versions
and rebuilds, and renaming the bundle keeps the plugin. Changing `plugin.id`
makes another plugin. A parameter's VST3 id is a hash of its id in the config
(as the JUCE runtime's), so renaming a parameter's key breaks automation that
hosts recorded for it.

**Installing.** Copy or link the bundle into `~/.vst3` (one user) or
`/usr/lib/vst3` (everyone), then rescan in the host:

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
  so it works when a host runs the component and the controller apart.
- **Presets.** [Factory presets](/docs/api/presets) are the root unit's
  program list, so a host's program selector loads them too.
- **The editor.** An X11 child window of the host's, in which the engine runs
  your UI as in the JUCE runtime: GPU composition where there is a GPU, CPU
  otherwise, Soundor's own X11 input (XInput 2) and AT-SPI accessibility. It
  resizes within the config's limits (`editor`), and follows the host's
  content scale.
- **`fetch()`** goes through the system's libcurl, loaded when first used
  (`libcurl.so.4`, else `libcurl-gnutls.so.4`), with the system's
  certificates and proxies, and HTTP/3 where that libcurl has it. Fedora and
  Ubuntu desktops install it; where there is none, `fetch()` rejects, saying
  so.
- **Pointer lock** (`requestPointerLock()`) hides the pointer and keeps it in
  the view as in the JUCE runtime. Under Wayland (XWayland), moving the
  pointer back is the compositor's to allow.
- **DevTools.** A Debug build (`soundor build vst3 --debug`, `soundor dev
  vst3`) connects to the DevTools session the environment variable
  `SOUNDOR_DEVTOOLS_SESSION` names, which `soundor dev` prints: start the host
  with it set.
- **Instances.** Every instance is independent. When the component and the
  controller share a process, the controller also reaches the processor's
  memory: the Rust controller's audio resources, `soundor:midi` from the UI
  and native streams. A host that runs them apart gets everything else.

## Limitations

- Linux x86_64 only; no AU, CLAP or standalone.
- `soundor dev vst3` builds the plugin and keeps its UI current, but opens no
  host: open the bundle in yours.
- The Rust controller's scheduled work runs while an editor is open, or with
  a host that lends its run loop to the controller.
- Dynamic latency and tail (`mode: 'dynamic'`) are reported as none.

## Validating a plugin

[pluginval](https://github.com/Tracktion/pluginval) is not part of the
runtime; run it yourself (CI runs it at its strictest level on every change
to the runtime):

```sh
curl -fsSLO https://github.com/Tracktion/pluginval/releases/download/v1.0.4/pluginval_Linux.zip
unzip pluginval_Linux.zip
./pluginval --strictness-level 10 --validate-in-process --validate ".soundor/dist/vst3/Acme Reverb.vst3"
```

Without a display, run it under `xvfb-run -a` for its editor tests.

Internals: [the VST3 runtime's architecture](/docs/contribute/vst3-runtime).
