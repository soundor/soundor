---
title: 'VST3 host internals'
description: 'How @soundor/vst3-host is built, selected, tested and released: the native executable, its protocol, prebuilt and source builds, platform packages, and resumable publishing.'
---

Source: [`hosts/vst3-host/`](https://github.com/soundor/soundor/tree/main/hosts/vst3-host).
User guide: [VST3 host](/docs/testing/vst3-host).

`@soundor/vst3-host` is an independently versioned package outside the
Changesets fixed group. It depends on no other Soundor package, on no JUCE
code and on no Soundor engine. `@soundor/driver` has it as an optional peer,
for [its `vst3` entry](/docs/driver/vst3), and nothing else depends on it. Its
normal `build` compiles the Node client only.

## Purpose

A VST3 host that tests, development tools and, later, other Soundor packages
can drive: load a plugin from its bundle path, process audio offline, open
its editor. The dependency direction, with `@soundor/juce-runtime` still to
come:

```text
@soundor/juce-runtime          @soundor/driver/vst3
          |                            |
          +-------------+--------------+
                        |
               @soundor/vst3-host
                 Node API + IPC
                        |
                 C++ executable
                        |
                   VST3 plugin
```

The host knows of neither. `@soundor/driver/vst3` starts the DevTools session
and passes its descriptor in the host's environment. A DevTools panel for host
controls (parameters, transport) would also sit on top of the Node API; the
host itself creates no DevTools session.

## Where the code is

| Path                         | What                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `native/src/`                | The executable: protocol, plugin lifecycle, processing, event loops, editor windows |
| `native/tests/`              | The self-test and the fixture plugins (`SoundorHostFixtures.vst3`)                  |
| `cmake/`                     | The pinned VST3 SDK (`Vst3HostDependencies.cmake`)                                  |
| `protocol.json`              | The protocol's version and limits, read by CMake and the client                     |
| `targets.json`               | The platform packages a release generates                                           |
| `src/`                       | The Node client: launching, requests, resolution and selection                      |
| `scripts/release.ts`         | Staging, platform package generation, tarball checks and publishing                 |
| `scripts/native.ts`          | `test:native`: a CMake workflow preset, then the integration tests                  |
| `tests/unit`, `tests/native` | Tests without and with the executable                                               |

The only third-party dependency is the [VST3 SDK](https://github.com/steinbergmedia/vst3sdk)
3.8.1 (MIT since 3.8): `pluginterfaces` and `public.sdk`'s hosting helpers in
the executable, plus `base` for the fixtures. Its three repositories are
fetched at configure time from exact commits, checked by SHA-256, compiled into
private static targets, and their archives kept in the user cache
(`SOUNDOR_CACHE`). Its license notice ships in every platform package. Windows
are native (X11 through `libX11.so.6` loaded in UI mode only, Cocoa, Win32);
there is no SDL or other UI library.

## How it works

### Process and threads

The client spawns the executable with `--ui` or `--headless` and speaks a
framed protocol over its stdin and stdout. Before anything else, the host
moves the protocol to private handles and points fd 1 at stderr (stdin at
nothing): plugins that print cannot corrupt it, and their output becomes
diagnostics.

Every SDK call except `process` runs on the main thread, which runs the
platform loop: a `poll` loop with the plugins' `IRunLoop` descriptors and
timers on Linux, the main run loop (NSApplication in UI mode) on macOS, a
message loop with a message-only window on Windows. A reader thread turns
stdin into frames and posts them to it.

Requests are handled one at a time, in order. `process` runs on an audio
worker thread while the main thread keeps its loop (and the editor) going; the
next request waits for it. Restarts a plugin asks for (`restartComponent`)
wait for the end of the current call and are applied before the next
request: deactivation, renegotiation for `kIoChanged`, reactivation.
Parameter edits from `setParameter` and the editor are queued and handed to
the processor at frame 0 of the next call. Nothing on the audio worker parses
JSON or does IPC.

The host exits when stdin closes; on Linux it also asks the kernel to kill it
with its parent. The client kills every host still running when Node exits.

### Protocol

```text
"SVH1" | u32 LE header length | u32 LE payload length | JSON header | payload
```

The first frame is the host's `hello` event (protocol version, host version,
SDK version, platform, architecture, mode, payload limit); the client refuses
another protocol version. Requests are `{ id, method, params }`, answered by
`{ id, result }` or `{ id, error: { code, message, details } }`; events are
`{ event, params }`. Audio travels in the payload as little-endian float32,
bus by bus and channel by channel, each channel `frames` long; state as raw
bytes. Headers are limited to 1 MiB and payloads to `maxPayloadBytes`, checked
by both sides before reading: an oversized or unframed stream ends the host
(`protocolError`, exit code 2), a malformed request inside a valid frame gets
an error answer. The version is bumped for any incompatible change.

### Selecting an executable

`resolveHost()` (what `launchHost()` uses) never builds or downloads: an
explicit `executable` or `SOUNDOR_VST3_HOST_EXECUTABLE`; in an installed
package, the platform package, checked against the client's version and
protocol, the recorded SHA-256 and (Linux) the glibc it needs; in a source
checkout, what `prepareHost()` selected, if it still matches the sources.

`prepareHost({ mode })` (`pnpm --filter @soundor/vst3-host build:native` for
`source`) has three modes:

- `prebuilt` (default): the published executable of exactly this version, if
  its native inputs match the checkout's; downloaded from npm, checked
  against the registry's SHA-512 integrity and its own provenance, and kept in
  the user cache, after which it needs no network. In a source checkout, a
  version that is not published, or sources that differ from it, are built
  locally instead. A network, registry or integrity error is an error, never
  taken for "not published". In an installed package, `prebuilt` is the
  platform package.
- `published`: the same published executable, and otherwise an error, never a
  build: what CI uses once `host-plan` has found that it matches.
- `source`: always a local, incremental Release build, in
  `build/host-<toolchain>`: the directory depends on the compiler, generator
  and architecture variables, since a CMake build directory keeps the
  toolchain it was configured with.

It prints which executable it selected and why, and records it in
`build/selected.json`. A CI artifact (`SOUNDOR_VST3_HOST_ARTIFACT`) is used
only if it matches the checkout's inputs and, given `GITHUB_SHA` or
`--commit`, its commit; otherwise selection fails.

The native inputs are a SHA-256 over `CMakeLists.txt`, `CMakePresets.json`,
`protocol.json`, `cmake/` (the SDK pin included), `native/src/` and the
package version, with line endings normalized. Documentation, tests, the Node
client and the lockfile do not change it; additions, deletions, uncommitted
edits do, and a reverted edit restores it. Git is not involved.

### Provenance

Every staged executable has a `soundor-vst3-host.json`: version, protocol,
target, architectures, configuration, source commit, native input
fingerprint, the executable's path, SHA-256 and size, and the newest glibc
it needs on Linux. Two builds have the same identity when version, target,
protocol and fingerprint match; the commit and the bytes may differ.

## Builds and tests

```sh
pnpm --filter @soundor/vst3-host test          # unit tests, no native build
pnpm --filter @soundor/vst3-host test:native   # dev preset + self-test + integration tests
pnpm --filter @soundor/vst3-host build:native  # select or build the executable
cd hosts/vst3-host
cmake --workflow --preset release              # the shipped configuration
cmake --workflow --preset tidy                 # clang-tidy
node scripts/native.ts test --preset sanitize  # ASan and UBSan
```

Native builds need CMake 3.25, a C++20 compiler and, on Linux, the X11
headers (with Xext, Xcomposite and Xdamage's); the fixtures link libX11. Nothing else in the workspace needs them:
`pnpm build` and `pnpm test` never compile the host.

The fixtures (`native/tests/fixtures`) are three classes in one bundle, built
with the SDK alone: _Fixture Gain_ (separate controller, sample-accurate gain,
mono or stereo, a sidechain, a real latency delay, an editor whose timer runs
on the host's loop, plugin-initiated resizing, content scale, parameters that
crash or hang `process`), _Fixture Synth_ (single component, MIDI in and
out, IMidiMapping, a transport readout, a tail) and _Fixture Broken_ (prints
to stdout, fails to initialize). The integration tests drive them through
the public API. On Linux without a display, the editor tests run under
`xvfb-run` when it is installed and are skipped otherwise.

## CI

`.github/workflows/vst3-host-artifacts.yml` (read-only) builds the release
configuration on Linux x64 (clang), macOS (universal, macOS 12) and Windows
x64 (MSVC), stages each executable with its provenance, runs the integration
tests against the staged executable, headless without a display and then the
editor tests (Xvfb on Linux), checks both slices of the macOS executable, and
keeps `vst3-host-<sha>-<target>` for seven days. With `checks`, a Linux job
adds clang-tidy and ASan/UBSan.

Verify uses it as it uses the engine's: `host-plan` decides, this workflow builds
once for each target, and the jobs that use the host take what was decided, never
compiling it. The plan builds the checkout when `turbo query affected` reports
`@soundor/vst3-host` (`.github/scripts/native-changes.mjs`, job `host`): a change
in the package, its workspace dependencies (the shared configs), turbo's global
dependencies or CI itself. Only then do `checks` run. It also builds when the job
that uses the host, Orbit's end-to-end tests, is affected and no release matches
this checkout (`selectHost()`). Otherwise that job uses the release.

Host changes never run the engine's suites, and engine changes never run the
host's. A change only under `hosts/vst3-host/` runs this job and Orbit's alone: the
graph has it reach the JUCE and benchmark packages through `@soundor/driver`, but
only that package's optional `vst3` entry uses the host.

Orbit's job is the one that runs `@soundor/driver/vst3` against a real plugin
(through `@soundor/vitest-e2e`). The Driver's unit tests use a simulated runtime, and
`packages/driver/src/vst3.plugin.test.ts` runs by hand against the real pieces; its
first lines say how.

## Releases

The platform packages are generated, never committed and never Changesets
packages. `targets.json` lists them; each takes the main package's exact
version. Changesets versions and changelogs `@soundor/vst3-host` alone.

When the release plan publishes `@soundor/vst3-host`, `.github/workflows/release.yml`:

1. builds the executables (or reuses those Verify built and tested in the
   same run);
2. in `pack`, generates one platform package per target from them
   (`release.ts generate`: one version, one commit, one fingerprint across
   all), packs and checks every tarball (`release.ts pack`: names, versions,
   `os`/`cpu`/`libc`, executable mode and SHA-256, provenance, notices, no
   scripts), and pins them exactly in the host's `package.json` before
   Changesets packs it; `check-main` checks the packed result;
3. in `publish`, before the Changesets publish step, publishes the platform
   packages (`release.ts publish`) and checks all are on npm
   (`release.ts verify`); then Changesets publishes the planned packages,
   the host among them.

`release.ts publish` first asks the registry for every target's version:

| Registry                                | Action                                  |
| --------------------------------------- | --------------------------------------- |
| 404                                     | publish                                 |
| present, same identity                  | verify (integrity, provenance) and skip |
| present, another identity               | fail; never overwrite                   |
| network, authentication or server error | fail; never taken for absence           |

A failed publish is followed by another query: a version another run
published meanwhile counts if it has the same identity. Re-running the failed
jobs reuses the run's artifacts. A run that fails before the Changesets step
leaves the main package unpublished, so it stays in the next run's plan and
the platform packages already published are verified and skipped. A later
commit whose native inputs differ cannot reuse a published version: it needs
a new version.

## How to change it

- A protocol change: bump `protocol.json`'s version, and change
  `native/src/Session.cpp` and `src/host.ts` together.
- A new target: add it to `targets.json` and the artifact workflow's matrix.
- A new SDK revision: update the commits and SHA-256s in
  `cmake/Vst3HostDependencies.cmake` and `NOTICE.md` (a changed pin changes
  the native inputs, so the next release builds anew).
- Add a changeset for `@soundor/vst3-host` for any change to the package.
