---
title: 'VST3 host'
description: 'Load a built VST3 plugin in a standalone host from Node: process audio offline, automate parameters, send MIDI, save state, and open its editor.'
---

`@soundor/vst3-host` loads a built `.vst3` bundle into a small native host
process and drives it from Node.js. Tests use it to check what a plugin does
with audio, parameters, MIDI and state: deterministic, offline, without a
DAW or an audio device. With `editor: true` it also opens the plugin's editor
in a native window.

It hosts any VST3 plugin, made with Soundor or not, built with VST3 SDK 3.8
or an older one (JUCE-built plugins included). The plugin must be built for
the operating system and CPU the host runs on.

```ts
import { launchHost } from '@soundor/vst3-host';
import { expect, test } from 'vitest';

test('halves the level', async () => {
  const host = await launchHost({
    plugin: 'build/MyPlugin.vst3',
    sampleRate: 48_000,
    blockSize: 512,
  });
  try {
    const gain = (await host.getParameters()).find((p) => p.title === 'Gain')!;
    await host.setParameter(gain.id, { plain: -6 });
    const input = new Float32Array(4800).fill(0.5);
    const { outputs } = await host.process({ inputs: [[input, input]] });
    expect(outputs[0]![0]![4799]).toBeCloseTo(0.25, 2);
  } finally {
    await host.close();
  }
});
```

## Installation

```sh
pnpm add -D @soundor/vst3-host
```

The package carries the Node API. Its executable comes in a platform package
that npm or pnpm installs with it, the one matching the machine, at exactly
the same version:

| Platform                         | Package                               |
| -------------------------------- | ------------------------------------- |
| Linux x64 (glibc)                | `@soundor/vst3-host-linux-x64-gnu`    |
| macOS 12 or later, arm64 and x64 | `@soundor/vst3-host-darwin-universal` |
| Windows x64                      | `@soundor/vst3-host-win32-x64`        |

Installing compiles nothing, downloads nothing else and runs no install
script. When optional dependencies are omitted (`--no-optional`,
`--omit=optional`) or `node_modules` was installed on another platform,
`launchHost()` fails with `platform-package-missing`: reinstall with optional
dependencies. To run an executable of your own, pass `executable` or set
`SOUNDOR_VST3_HOST_EXECUTABLE`.

## Headless and UI mode

One executable, two modes:

- **Headless** (default): no window, and no display or video system is
  touched. It runs on CI machines without X11 or a GPU. The host still runs
  its main thread's event loop, which plugins rely on (posted main-thread
  work, Linux's `IRunLoop` timers).
- **UI** (`editor: true`): the plugin's editor opens in a native window
  (X11 on Linux, Cocoa on macOS, Win32 on Windows), and every audio call
  still works. Linux needs a display (`DISPLAY`; Xvfb on CI).

```ts
const host = await launchHost({ plugin, editor: true });
host.on('editorClosed', () => console.log('the user closed it'));
await host.resizeEditor(800, 600); // within the plugin's own limits
await host.closeEditor();
await host.openEditor({ scale: 2 });
```

`openEditor`, `closeEditor`, `resizeEditor` and `getEditor` report the
editor's size, whether it can be resized, and its content scale. Sizes are in
pixels on Windows and Linux and in points on macOS, as VST3 defines them.
Resizes the plugin asks for itself are followed and reported as
`editorResized`. The window adds no controls of its own.

## Choosing the plugin class and setup

A bundle may contain several audio processor classes. Choose one with
`className` or `classId` (a 32-digit hexadecimal id); without either, a
bundle of several fails with `ambiguous-class`, listing them.

`sampleRate` (default 48000), `blockSize` (the largest block, default 512)
and `processMode` (`'realtime'`, the default and what a DAW's playback does,
`'offline'` or `'prefetch'`) are passed to the plugin's `setupProcessing`.
`host.configure({ ... })` changes them later; what is not given stays.

Audio buses are set up by index. Each entry is `null` (the plugin's default)
or `{ channels, arrangement, active }`:

```ts
await launchHost({
  plugin,
  inputs: [{ channels: 1 }, { active: true }], // mono main input, sidechain on
  outputs: [{ arrangement: 'mono' }],
});
```

`channels` picks the usual arrangement for a count; `arrangement` takes
`'mono'`, `'stereo'`, an SDK name such as `'5.1'`, or a speaker mask such as
`'0x3'`. A plugin that does not accept the request fails the launch (or
`configure`) with `unsupported-configuration`, naming what it proposes
instead. By default main buses and those the plugin marks default-active are
active; event buses are always active. `host.info.buses` lists the result.

## Processing audio

```ts
const result = await host.process({
  inputs: [[left, right], [sidechain]], // by bus, by channel
  frames: 48_000, // default: the input length
  parameterChanges: [{ id, value: 0.8, time: 1200 }],
  events: [{ type: 'noteOn', time: 0, pitch: 60, velocity: 0.8 }],
  transport: { playing: true, tempo: 128, musicalPosition: 16 },
});
result.outputs[0]; // [Float32Array, Float32Array]
```

- **Audio** is `Float32Array` per channel. A given bus has exactly the bus's
  channel count, every channel the same length. A missing, `null` or
  `undefined` bus gets silence; an inactive bus takes none. Input arrays are
  copied and never changed; output arrays are new and the caller's. Every
  output bus is returned, an inactive one with no channels.
- **Blocks.** A call may cover any number of frames: the host processes them
  in blocks of at most `blockSize`, and moves parameter changes and events into
  the block they fall in. The result does not depend on the block size, as far
  as the plugin's own processing does not. A call of `frames: 0` delivers
  parameter changes only.
- **Times** are frames from the start of the call (`0 ≤ time < frames`).
- **Limits.** One call's input or output must fit `maxPayloadBytes` (default
  256 MiB): process long signals in several calls. Plugin state, held notes
  and the transport carry over between calls.

### Parameters

VST3 parameters have numeric ids (`ParamID`, an unsigned 32-bit integer),
stable across instances and sessions of a plugin; `getParameters()` lists
them with their titles, units, step counts, flags and current values.

Values are **normalized** (0 to 1, what VST3 automates) or **plain** (the
plugin's own units, converted by its controller). `setParameter(id, 0.5)` and
`setParameter(id, { normalized: 0.5 })` are the same; `{ plain: -6 }` asks the
controller to convert. Read-only parameters cannot be set; values outside 0 to
1 are rejected.

`setParameter` changes the controller at once and reaches the processor at
the first frame of the next `process` call. Changes in `parameterChanges`
apply at their frame. Edits made in the editor (`performEdit` events) also
reach the processor at the start of the next call. What the processor
reports back (meters, read-only values) is in `result.parameterChanges`, and
the controller is updated with it.

### MIDI

Event inputs: `noteOn`, `noteOff` and `polyPressure` (on event bus `bus`,
default 0), and `controlChange`, `pitchBend` and `channelPressure`. VST3 has
no MIDI controller events: those three become parameter changes through the
plugin's `IMidiMapping`; one the plugin does not map is dropped and reported
in `result.warnings`. The plugin's event outputs are in `result.events`
(notes, poly pressure and legacy MIDI CC output), with their frames.

### Transport

The host keeps a transport across calls: playing or not, tempo, time
signature and position. `transport` in a `process` call changes it before
processing (`samplePosition` in frames or `musicalPosition` in quarter notes,
not both); while playing it advances by the frames processed. The plugin
receives it as its `ProcessContext` each block, and `result.transport` is its
state after the call. Nothing else in the context depends on the clock: it is
the same on every run.

### Latency and tail

`getLatency()` returns `{ latencySamples, tailSamples }` (`'infinite'` for a
plugin that never stops). The host does not compensate latency: output is
delayed by `latencySamples` frames, as a DAW would see it before compensating.
Nor does it render the tail by itself: process more frames to get it. When a
plugin's latency changes, it asks for a restart; the host deactivates and
reactivates it between calls and emits `restart`.

## State, reset and recreate

```ts
const state = await host.getState(); // { component, controller } bytes
await host.recreate(); // a fresh instance, same class and setup
await host.setState(state);
```

`getState` returns the processor's and the controller's state as the plugin
writes them; pending parameter changes reach the processor first. `setState`
restores both and brings the controller in line. `reset()` deactivates and
reactivates the plugin (delay lines, held notes), keeping the transport;
`recreate()` makes a new instance in the same process and starts the
transport over.

## Requests, errors and closing

Requests run one at a time in the order they are made. Each has a timeout
(`requestTimeout`, default 60 s; `timeout` per call): a request the host does
not answer in time stops the host, since its state is unknown, and fails with
`timeout`. An `AbortSignal` (`signal`) cancels a request that has not started;
one already running is finished by the host and its answer dropped.

Failures are `Vst3HostError`s with a `code`:

| Code                                                    | Meaning                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `plugin-not-found`, `invalid-bundle`                    | No such path, or not a `.vst3` bundle                                                 |
| `incompatible-architecture`                             | No binary for this CPU; `details.architectures` lists the bundle's                    |
| `load-failed`, `initialization-failed`                  | The binary did not load, or the plugin failed to initialize or activate               |
| `ambiguous-class`, `no-matching-class`                  | Choose a class; `details.classes` lists them                                          |
| `unsupported-plugin`, `unsupported-configuration`       | Not an audio processor, no 32-bit float processing, or a refused setup                |
| `invalid-request`, `unknown-parameter`, `invalid-state` | The request is wrong; the message says how                                            |
| `plugin-error`                                          | The plugin refused (a failed `process`, unreadable state)                             |
| `headless`, `no-editor`, `no-display`                   | Editor requests without UI mode, without an editor, or without a display              |
| `host-exited`, `timeout`                                | The process ended (a crash: `details.code` or `details.signal`), or stopped answering |
| `closed`, `aborted`                                     | The host was closed, or the request was aborted                                       |

The host's and the plugin's own output (stderr, and what plugins print to
stdout) never mix with the protocol: `onLog` receives it line by line, and the
last of it is appended to `host-exited` and `timeout` errors. On Windows, what
a plugin with its own statically linked C runtime prints to stdout is lost
rather than logged; its stderr output is logged.

`close()` unloads the plugin and ends the process, and kills it if it does not
end in time. It is safe to call more than once, after a failure, and in
`finally`; a `using`/`await using` declaration also closes. Hosts never outlive
the Node process that launched them.

## Environment

The host inherits `process.env`; `env` adds or overrides variables (an
`undefined` value removes one) and `inheritEnv: false` passes only `env`. This
is how a plugin built with Soundor gets `SOUNDOR_DEVTOOLS_SESSION`: the host
passes it through and creates no DevTools session itself. Nothing the host
writes to its protocol or logs includes the environment.

## Troubleshooting

- **`platform-package-missing`**: reinstall with optional dependencies, on
  the machine that runs the tests.
- **`incompatible-architecture`** on macOS: the host is universal and runs
  natively, so an x64-only plugin is not loaded on Apple silicon (nor the
  reverse). Build the plugin universal.
- **`no-display`** on Linux: run headless, or under `xvfb-run`.
- **`load-failed`** with a missing symbol or library: the plugin's binary
  needs something this machine lacks; the message is the loader's.
- **A test hangs**: give it a `timeout`; the host is stopped, and the plugin's
  last output is in the error.
