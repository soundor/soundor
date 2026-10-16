# Soundor Engine

The Soundor Engine (`@soundor/engine`) is the native C++ runtime inside every
Soundor plugin: it runs the UI's JavaScript in Hermes, lays it out with Yoga,
draws it with Skia (and WebGL through ANGLE), and presents its accessibility
to the platform. It knows nothing of JUCE. The JUCE runtime
(`@soundor/juce-runtime`) is the plugin around it: it generates the JUCE
project, the processor and editor, the parameter and `soundor:native`
bindings, and links the engine as one CMake target, `Soundor::Engine`.

|                 | `@soundor/engine`                                  | `@soundor/juce-runtime`                       |
| --------------- | -------------------------------------------------- | --------------------------------------------- |
| What            | the C++ runtime, its headers, dependency recipes   | the JUCE plugin, codegen, `soundor dev/build` |
| Versioned       | independently (outside the Changesets fixed group) | with the other Soundor packages               |
| Depends on JUCE | never                                              | yes (your JUCE checkout, never downloaded)    |
| Ships binaries  | as a separate prebuilt release                     | no                                            |

The [engine reference](../runtimes/engine/README.md) documents its API, its
modules and its internals; this page is about getting it into a plugin.

## Architecture and dependencies

```text
plugin (JUCE)                     your processor, editor, DSP
  └─ JUCE adapters, bindings       @soundor/juce-runtime (generated + native/)
       └─ Soundor::Engine          @soundor/engine
            ├─ Hermes              JavaScript (interpreter; hermesc compiles bytecode at build time)
            ├─ Yoga, ada           layout, URLs
            ├─ Skia                2D drawing (CPU, into layers)
            ├─ ANGLE               WebGL 2 and the GPU compositor (Metal, Direct3D 11)
            └─ AccessKit           accessibility on Windows and Linux (own bridges on macOS)
```

Every dependency is pinned (`runtimes/engine/cmake/SoundorDependencies.cmake`),
linked statically and hidden: two Soundor plugins in one host never share or
clash on a symbol.

## Prebuilt and source mode

```ts
import { juceRuntime } from '@soundor/juce-runtime';

juceRuntime(); // prebuilt (the default)
juceRuntime({ engine: { mode: 'prebuilt' } }); // the same, explicitly
juceRuntime({ engine: { mode: 'source' } }); // compile the engine
```

**Prebuilt** links the libraries published for the installed engine version.
The first build downloads the archive it needs (tens of megabytes) into the
Soundor cache, verifies its SHA-256 against the manifest in the npm package,
and reuses it from then on, offline included. Nothing heavy is compiled: a
plugin builds in a minute or two.

**Source** compiles the installed engine's sources, and with them Skia, ANGLE
and Hermes (once per machine, into the same cache: the first build takes tens
of minutes and needs git, Python 3 and Ninja). Use it to change or debug the
engine, or on a platform without prebuilts.

Both give the plugin the same `Soundor::Engine` target and the same JUCE
adapters. Prebuilt mode never falls back to source: when the prebuilt cannot
be used, the configure stops and says why.

## Debug and Release

| Build           | Engine variant | Hermes                               | DevTools | Windows C runtime |
| --------------- | -------------- | ------------------------------------ | -------- | ----------------- |
| `soundor dev`   | debug          | with its compiler: reloads UI source | yes      | `/MDd`            |
| `soundor build` | release        | bytecode only, compiled at build     | no       | `/MD`             |

The engine's own code is compiled for the variant; Skia, ANGLE and Hermes are
optimized builds in both, built against the matching C runtime on Windows.
Release, RelWithDebInfo and MinSizeRel all link the release engine.

## Supported platforms

| Target          | Architectures                 | Minimum                                      |
| --------------- | ----------------------------- | -------------------------------------------- |
| macOS universal | arm64 and x86_64, one archive | macOS 12                                     |
| Linux x64       | x86_64, glibc                 | glibc and libstdc++ of Ubuntu 24.04 or newer |
| Windows x64     | x64, MSVC                     | the DLL C runtime                            |

The archive is chosen by the platform the plugin **targets**
(`CMAKE_OSX_ARCHITECTURES` included), not the machine it builds on. Anything
else builds in source mode.

## ABI versioning

The engine version is its C++ ABI: every symbol lives in
`soundor::v<major>_<minor>_<patch>` (engine 0.2.1: `soundor::v0_2_1`; code
writes `soundor::RuntimeHost` as usual). A plugin's generated code calls an
out-of-line anchor whose signature also encodes the variant, the C++ standard
library, iterator debugging, the C runtime and the DevTools layout: headers and
libraries that disagree on any of them fail to **link**, not at run time.
Every engine version therefore has its own prebuilt release, even one that
only changed documentation.

## Distribution and integrity

The binaries are not in the npm package. They are the GitHub release
`engine-prebuilts-v<version>-<commit>-r<revision>` of this repository: six
archives (three targets, two variants), `build-info.json` and `SHA256SUMS`.
The npm package carries `artifacts/manifest.json`, written when it is
published, naming each archive's URL and SHA-256.

- The release is published, and its every asset downloaded anonymously and
  checked, before the npm package is published.
- A build verifies the archive's SHA-256 before extracting it, then checks the
  extracted engine against the package: version, ABI namespace, Hermes
  revision, variant, platform, architectures, macOS deployment target, MSVC C
  runtime, and the commit the manifest names.
- The cache, `<SOUNDOR_CACHE>/engine-prebuilts/` (by default
  `~/.cache/soundor`, `~/Library/Caches/Soundor`, `%LOCALAPPDATA%\Soundor\cache`),
  is keyed by SHA-256. An archive is used only after it matched; a corrupt or
  interrupted one is downloaded again. Parallel builds share it safely.
- Published releases are immutable, and a published npm version keeps the
  manifest it shipped with. A defective release is never edited. Before its
  engine version is on npm, a rebuild of the same commit under the next
  revision (`-r2`, a manual `publish` run of the workflow) replaces it: the
  release workflow names the highest published revision. After, the fix is a
  new engine version, whose release starts again at `-r1`.

## Developing the engine (pnpm workspace)

Inside this repository `@soundor/engine` is the local package: it has no
manifest, so the examples and the JUCE test plugin use `mode: 'source'`, and an engine edit is compiled
into the next `soundor dev` or `soundor build` with no publishing. The native
tests run without JUCE:

```sh
cd runtimes/engine
cmake --workflow --preset dev          # Debug engine and its tests
cmake --workflow --preset sanitize     # with ASan/UBSan
```

`cmake --workflow --preset prebuilt-debug` (and `-release`) builds an archive's
contents locally; `.github/workflows/engine-prebuilts.yml` builds the real ones
(see the [reference](../runtimes/engine/README.md#prebuilt-engines)).

## Debugging native engine code

Use source mode: the engine is then compiled in your build, with its sources
on disk and debug information, and a debugger steps into it like your own
code. The debug prebuilt is a Debug build too, but compiled elsewhere: its
paths point at the build machine. `soundor dev` prints the engine's log
(including JavaScript errors, with source-mapped stacks); native crashes are
best reproduced in the Standalone format under a debugger.

## Troubleshooting

| Message                                                            | What to do                                                                                                                                      |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `has no prebuilt engine: only its published npm package names one` | A workspace or unpublished engine: use `mode: 'source'`.                                                                                        |
| `There is no prebuilt engine for <platform>`                       | Not one of the three targets: use `mode: 'source'`.                                                                                             |
| `Downloading the debug/release prebuilt engine failed`             | No network on the first build, a proxy or firewall in the way, or a checksum mismatch (the file is not kept). Connect once, or use source mode. |
| `is for @soundor/engine X, not Y` / `ABI namespace`                | A stale build directory or a mixed install: reinstall, delete the build directory.                                                              |
| `needs macOS 12 or later`                                          | Raise `CMAKE_OSX_DEPLOYMENT_TARGET`, or use source mode.                                                                                        |
| `uses the MultiThreadedDLL C runtime`                              | The plugin uses a static C runtime: use the default (`/MD`, `/MDd`).                                                                            |
| `Set SOUNDOR_ENGINE_PREBUILT_RELEASE_DIR to build Release`         | A Visual Studio tree configured for Debug only: configure it for the configuration you build.                                                   |
| `SOUNDOR_ABI_NAMESPACE is owned by @soundor/engine`                | A build directory from an older runtime: delete it.                                                                                             |

## Licenses and attribution

The engine is MIT licensed. Its dependencies are permissive (BSD, MIT,
Apache-2.0, zlib, IJG and similar) but require their notices to accompany
binaries: every prebuilt archive carries all of them in `licenses/`, and the
npm package the ones the dependencies' own builds leave out
(`runtimes/engine/licenses`, see its README). **A plugin you distribute
contains the engine**, so distribute those notices with it, whichever mode
built it. JUCE is never part of the engine; its license is between you and
JUCE.
