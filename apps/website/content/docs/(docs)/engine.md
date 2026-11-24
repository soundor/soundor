---
title: 'Soundor Engine'
description: 'Native engine modes, the WebAssembly core, supported prebuilt platforms, the engine() Node API, ABI checks, caching, and troubleshooting.'
---

The Soundor Engine (`@soundor/engine`) is the native C++ runtime inside every
Soundor plugin: it runs the UI's JavaScript in Hermes, lays it out with Yoga,
draws it with Skia (and WebGL through ANGLE), and presents its accessibility
to the platform. It knows nothing of plugin formats. The VST3 runtime
(`@soundor/vst3-runtime`) is the plugin around it: a prebuilt VST3 adapter
that hosts the engine and the project's Rust crate, linked with the engine's
prebuilt archive.

|                | `@soundor/engine`                                  | `@soundor/vst3-runtime`                         |
| -------------- | -------------------------------------------------- | ----------------------------------------------- |
| What           | the C++ runtime, its headers, dependency recipes   | the VST3 adapter, the plugin build, `dev/build` |
| Versioned      | independently (outside the Changesets fixed group) | independently (outside the fixed group)         |
| Ships binaries | as a separate prebuilt release (native and wasm)   | its prebuilt adapters, as a separate release    |

The [engine reference](/docs/contribute/engine-reference) documents its API, its
modules and its internals; this page is about getting it into a plugin.

## Architecture and dependencies

```text
plugin (VST3)                     your UI, processor and controller
  └─ VST3 adapter                  @soundor/vst3-runtime (prebuilt, Steinberg's SDK)
       └─ Soundor::Engine          @soundor/engine
            ├─ Hermes              JavaScript (interpreter; hermesc compiles bytecode at build time)
            ├─ Yoga, ada           layout, URLs
            ├─ Skia                2D drawing (Ganesh GPU on macOS, Windows and Linux, CPU fallback)
            ├─ ANGLE               WebGL 2 and the GPU compositor (Metal, Direct3D 11)
            ├─ Windows UIA        native Windows accessibility
            └─ System GIO          native Linux AT-SPI (dynamically linked)
```

Bundled dependencies are pinned (`engine/cmake/SoundorDependencies.cmake`),
linked statically and hidden. Linux accessibility uses the system shared GIO library;
macOS uses native NSAccessibility.

## Prebuilt and source engines

A plugin build gets the engine through [`engine()`](#in-node-engine), for the
exact `@soundor/engine` version the VST3 runtime depends on, in its default
`prebuilt` mode: the published archive for the platform and variant,
downloaded once into the Soundor cache, verified by SHA-256, and reused from
then on, offline included. Nothing heavy is compiled: a plugin builds in a
minute or two.

In the engine's source checkout (Soundor's workspace), prebuilt mode compares
the engine's build-input fingerprint with the published one. Matching inputs
use the prebuilt; native edits, an unpublished version, or an older release
without a fingerprint build the local sources, and with them Skia, ANGLE and
Hermes (once per machine, into the same cache: the first build takes tens of
minutes and needs CMake, git, Python 3 and Ninja). Tests and documentation do
not change the fingerprint. Native sources, headers, embedded JavaScript,
CMake recipes, lowering scripts and installed lowering dependencies do. Added,
deleted and uncommitted files count too.

A workspace resolves the manifest from the exact published npm version, checking
the npm archive's SHA-512 integrity, and caches it in
`<SOUNDOR_CACHE>/engine-manifests/`. Installed packages carry their own manifest.
A missing network connection or corrupt download is an error, not a reason to
silently start a source build. An explicit CI manifest (`SOUNDOR_ENGINE_MANIFEST`)
or extracted archive must match: a mismatch fails the build.

## The WebAssembly core

The web runtime lays its UI out with the same engine, compiled to WebAssembly:
`soundor-core.wasm`, the engine's platform-independent C++ core (node tree,
styles, Yoga, text layout) without Hermes, Skia or ANGLE. Its JavaScript,
`@soundor/engine/web`, is in the npm package; the module is not. It is part of
the engine's prebuilt release, and the web runtime prepares it in Node, while
`soundor dev` or `soundor build` starts: the published module of the installed
engine version, downloaded once into the Soundor cache and verified. The page
then loads it from the application's own assets (a content-hashed file),
never from GitHub.

So a web plugin needs no Emscripten, CMake or C++ compiler: Node and a
package manager are enough. Emscripten is for engine contributors
([below](#developing-the-engine-pnpm-workspace)).

`SOUNDOR_ENGINE_WASM` names a module to use instead (an unreleased build, a
CI artifact): it is checked to be the engine's, speaking the protocol of the
installed `@soundor/engine/web`, and used as it is.

## In Node: `engine()`

Build tooling gets the engine's binaries from `@soundor/engine`'s one Node
function, which the web runtime uses for its module:

```ts
import { engine } from '@soundor/engine';

const web = await engine({ target: 'web' });
web.files.wasm; // …/soundor-core.wasm (absolute)

const native = await engine({ target: 'linux-x64' }); // variant: 'release' by default
native.includeDirs; // the extracted archive's headers
native.libraries; //   its static libraries, in link order
native.linkFlags; //   system libraries and frameworks
native.hermesc; //     the Hermes compiler of the same build
```

| Target            | What                                                                    |
| ----------------- | ----------------------------------------------------------------------- |
| `web`             | `soundor-core.wasm`                                                     |
| `linux-x64`       | a native archive (`variant`: `debug` or `release`)                      |
| `macos-universal` | a native archive (`debug` or `release`)                                 |
| `windows-x64`     | a native archive (`debug`, `release`, `debug-static`, `release-static`) |

| Mode                 | What it uses                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prebuilt` (default) | The engine version's published artifact, from the cache or downloaded into it. In the engine's source checkout only if the artifact's input fingerprint matches the sources; otherwise a local build of them |
| `published`          | The published artifact and nothing else: an error when there is none or the sources differ from it (release builds, CI)                                                                                      |
| `source`             | Always a local build: in the engine's source checkout, or (native targets) of an installed package's sources into the cache (`engine-source/<version>/<target>-<variant>/`, built once), with CMake          |

The result says where it came from (`mode`: `prebuilt`, `source`, or
`override` for `SOUNDOR_ENGINE_WASM`) and why (`reason`). The VST3 runtime links a
native artifact's libraries; its adapter is compiled against the same archive
through the engine's CMake (`Soundor::Engine`). Failures are errors
named `SoundorEngineError`, with a `code` (`unavailable`, `manifest`,
`download`, `artifact`, `build`, `invalid-options`).

Nothing is downloaded or compiled when a package is installed: only when
`engine()` runs, once per artifact. An installed package compiles its native
engine only in mode `source` (the VST3 runtime's
`vst3Runtime({ engine: { mode: 'source' } })`): a missing release is an
error in the other modes, never a reason to compile for minutes. That build
needs CMake, Ninja (on Windows, Visual Studio) and a C++20 compiler.

## Debug and Release

| Build           | Engine variant | Hermes                               | DevTools | Windows C runtime |
| --------------- | -------------- | ------------------------------------ | -------- | ----------------- |
| `soundor dev`   | debug          | with its compiler: reloads UI source | yes      | `/MTd`            |
| `soundor build` | release        | bytecode only, compiled at build     | no       | `/MT`             |

The engine's own code is compiled for the variant; Skia, ANGLE and Hermes are
optimized builds in both, built against the matching C runtime on Windows.
`soundor build vst3 --debug` uses the debug engine with DevTools and embeds its
UI for tests ([debug builds](/docs/cli/build#debug-builds)).

## Supported platforms

| Target          | Architectures                 | Minimum                            |
| --------------- | ----------------------------- | ---------------------------------- |
| macOS universal | arm64 and x86_64, one archive | macOS 12                           |
| Linux x64       | x86_64, glibc                 | glibc 2.39 (Ubuntu 24.04) or newer |
| Windows x64     | x64, MSVC                     | no Visual C++ Redistributable      |

Each platform builds its own plugins; there are none for other platforms.

### macOS

A plugin runs on macOS 12 or later, the engine's minimum, whatever macOS it is
built on. Building one needs Apple's Command Line Tools. Building the engine
from source (in Soundor's workspace) also needs CMake, Ninja, and Xcode
selected, and on Xcode 26 or later its Metal tools: ANGLE compiles its Metal
shaders when it is built, and Command Line Tools have no `metal`. Having Xcode
installed is not enough if Command Line Tools are still selected:

```sh
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
xcodebuild -downloadComponent MetalToolchain # Xcode 26 or later
```

### Linux

A plugin carries its own C++ runtime, statically linked and hidden, in every
build, so plugins don't depend on the system's `libstdc++` or on each other's.
What it can't carry is glibc, which a plugin shares with the host that loads it.
So a release runs only where glibc is at least as new as on the machine that
built it: **build the releases you ship on Ubuntu 24.04**, not on a newer desktop
distribution.

| Where           | Needs                                                                  |
| --------------- | ---------------------------------------------------------------------- |
| A user's system | glibc 2.39 or newer, `libfontconfig`, `libfreetype`, `libgio-2.0.so.0` |
| A build machine | a C++ compiler driver and its static C++ library                       |

An engine built from source also needs CMake, Ninja, pkg-config and GIO's
development files (GLib's: `libglib2.0-dev` on Ubuntu/Debian), and the X11 and XInput 2 headers
(`libx11-dev` and `libxi-dev`; `libX11-devel` and `libXi-devel` on Fedora),
for Soundor's own Linux input. Nothing is linked: an editor loads `libX11`
and `libXi`, which every X11 or XWayland desktop has, when it opens.

The static library comes with the compiler on most distributions. On Fedora and
RHEL it is a separate package, and every build stops without it, before compiling
anything:

```sh
sudo dnf install libstdc++-static
```

### Windows

A plugin includes the C runtime (`/MT`, and `/MTd` in Debug), so it needs no
Visual C++ Redistributable, and an older runtime a host has loaded can't crash
it. Everything linked into a plugin has to use the same runtime, so a
precompiled library your crate links needs an `MT` build (Rust's
`crt-static`, which the runtime sets). A mismatch fails to link with `LNK2038`.

Prebuilt engines are built with MSVC 19.44, so linking one needs Visual Studio 2022
17.14 or newer.

## ABI versioning

The engine version is its C++ ABI: every symbol lives in
`soundor::v<major>_<minor>_<patch>` (engine 0.2.1: `soundor::v0_2_1`; code
writes `soundor::RuntimeHost` as usual). The adapter calls an
out-of-line anchor whose signature also encodes the variant, the C++ standard
library, iterator debugging, the C runtime and the DevTools layout: headers and
libraries that disagree on any of them fail to **link**, not at run time.
Every engine version therefore has its own prebuilt release, even one that
only changed documentation.

## Distribution and integrity

The binaries are not in the npm package. They are the GitHub release
`engine-prebuilts-v<version>-<commit>-r<revision>` of this repository: eight
native archives (Debug and Release for Linux and macOS, plus both
configurations for each Windows C runtime), the WebAssembly core's
(`soundor-engine-<version>-web-release.tar.gz`, about 150 KB), `build-info.json`
and `SHA256SUMS`. No release is published without every one of them.
The npm package carries `artifacts/manifest.json`, written when it is
published, naming each archive's URL and SHA-256, the commit and input
fingerprint it was built from, and for the WebAssembly core its own
fingerprint and protocol version.

- The release is published, and its every asset downloaded anonymously and
  checked, before the npm package is published.
- A build verifies the archive's SHA-256 before extracting it, then checks the
  extracted engine against the package: version, ABI namespace, Hermes
  revision, variant, platform, architectures, macOS deployment target, MSVC C
  runtime, and the commit the manifest names. `engine()` checks the same
  identity (version, ABI namespace, target, variant, commit, fingerprint) and,
  for the WebAssembly core, the module's SHA-256 and that it speaks the
  protocol of the installed `@soundor/engine/web`, on every use.
- The cache, `<SOUNDOR_CACHE>/engine-prebuilts/` (by default
  `~/.cache/soundor`, `~/Library/Caches/Soundor`, `%LOCALAPPDATA%\Soundor\cache`),
  is keyed by SHA-256, and shared by CMake and `engine()`. An archive is used
  only after it matched; a corrupt or interrupted one is downloaded again, and
  a damaged extraction is extracted again. Extractions appear whole (renamed
  into place) and parallel builds wait for each other. A download, checksum or
  manifest failure is an error: it is never taken for an unpublished version,
  and never makes anything build from source instead. Verified copies are
  reused offline.
- Published releases are immutable, and a published npm version keeps the
  manifest it shipped with. A defective release is never edited. Before its
  engine version is on npm, a rebuild of the same commit under the next
  revision (`-r2`, a manual `publish` run of the workflow) replaces it: the
  release workflow names the highest published revision. After, the fix is a
  new engine version, whose release starts again at `-r1`.

## Developing the engine (pnpm workspace)

The examples use automatic selection: unchanged engine inputs use matching
released libraries, while engine edits compile from the checkout. Reverting the
edits selects the released prebuilt again if it matches. The VST3 runtime's
adapter is built against the same engine (`pnpm --filter @soundor/vst3-runtime
build:native`), and builds again after an engine edit.

Ordinary repository checks (`pnpm check`) build and test the JavaScript tooling
without compiling the native engine. Run `pnpm test:native` for engine tests,
`pnpm lint:native` for static analysis, or `pnpm check:native` for both. Tests
always exercise source builds unless a prebuilt-check preset is selected:

```sh
cd engine
cmake --workflow --preset dev          # Debug engine and its tests
cmake --workflow --preset sanitize     # with ASan/UBSan
```

`cmake --workflow --preset prebuilt-debug` (and `-release`) builds an archive's
contents locally; `.github/workflows/engine-prebuilts.yml` builds the real ones
(see the [reference](/docs/contribute/engine-reference#prebuilt-engines)).

The WebAssembly core follows the same rule, with its own fingerprint: only
what reaches the module counts (the core's sources and the headers they
include, `wasm/`, the CMake its build reads, Yoga's pin and patch, the
pinned Emscripten in `wasm/emscripten.json`). The web runtime's tests, the
examples and the website use the published module while those match; after
an edit to them (or on a version not yet published) they build it, which
needs Emscripten (`source <emsdk>/emsdk_env.sh`, the version
`wasm/emscripten.json` names), and reuse that build while the sources stay
the same. `pnpm --filter @soundor/engine build:wasm` builds it explicitly
(`engine({ target: 'web', mode: 'source' })`): incrementally, into
`build/wasm/`, staged in `build/wasm/stage/` as a release archive holds it.
Local builds stay in the checkout; the cache holds only downloaded releases.
Ordinary React or TypeScript edits never rebuild it.

## Debugging native engine code

Build the engine from its sources (an edit in Soundor's workspace, or
`engine({ mode: 'source' })`): it is then compiled with its sources on disk
and debug information, and a debugger steps into it like your own code. The
debug prebuilt is a Debug build too, but compiled elsewhere: its paths point
at the build machine. `soundor dev` prints the engine's log (including
JavaScript errors, with source-mapped stacks); native crashes are best
reproduced in the VST3 host (`@soundor/vst3-host`) under a debugger.

## Troubleshooting

| Message                                                  | What to do                                                                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `has no prebuilt engine`                                 | The exact version has no published manifest: remove the explicit manifest, or build the engine from source in its checkout.   |
| `Downloading the debug/release prebuilt engine failed`   | No network on the first build, a proxy or firewall in the way, or a checksum mismatch (the file is not kept). Connect once.   |
| `is for @soundor/engine X, not Y` / `ABI namespace`      | A stale build directory or a mixed install: reinstall, delete the build directory.                                            |
| `adapter was built against another engine`               | In Soundor's workspace, after an engine edit: `pnpm --filter @soundor/vst3-runtime build:native`.                             |
| `has no web artifact`                                    | The engine version's release predates the WebAssembly core: update `@soundor/engine`, or set `SOUNDOR_ENGINE_WASM`.           |
| `Could not read the prebuilt manifest`                   | The npm registry could not be reached the first time, or answered with an error: connect once (the manifest is then cached).  |
| `Downloading soundor-engine-…-web-release.tar.gz failed` | As for native archives: connect once, or check the proxy. Nothing is built instead.                                           |
| `speaks protocol N; this @soundor/engine speaks M`       | A module of another engine version (often `SOUNDOR_ENGINE_WASM`): use the module of the installed version.                    |
| `needs Emscripten`                                       | In the engine's checkout, its WebAssembly sources differ from the release: install the pinned Emscripten, or revert the edit. |

## Licenses and attribution

The engine is MIT licensed. Its dependencies are permissive (BSD, MIT,
Apache-2.0, zlib, IJG and similar) but require their notices to accompany
binaries: every prebuilt archive carries all of them in `licenses/`, and the
npm package the ones the dependencies' own builds leave out
(`engine/licenses`, see its README). The WebAssembly core's are the engine's,
Yoga's and those of the Emscripten system libraries it contains (musl's libc),
in its archive and in the npm package (`webLicenses()`).

**A plugin you distribute contains the engine**, whichever mode built it, and
its build ships these notices on its own: the VST3 runtime copies the
archive's into the bundle's `licenses/engine/`, the web runtime the
WebAssembly core's into `licenses/engine/` of its site, beside the notices of
everything else the plugin contains. See
[Third-party notices](/docs/licenses).
