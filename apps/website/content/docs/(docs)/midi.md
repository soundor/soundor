---
title: MIDI
description: MIDI 1.0 messages and host capabilities.
---

Declare host capabilities independently in `soundor.config.ts`:

```ts
midi: { input: true, output: true },
```

Both default to `false`. Internal UI and controller messages do not require
host input or output. Declaring a capability does not select a hardware device.

Soundor's MIDI 1.0 model supports Note On, Note Off, Control Change, Pitch
Bend, Program Change, Channel Pressure and Polyphonic Aftertouch. Channels
are **1–16**. Notes, velocities, controllers, programs and pressures are
integers **0–127**; pitch bend is **0–16383**, centred at **8192**. A Note On
with zero velocity retains its Note On representation; a synthesizer should
treat it as a release.

A message contains only MIDI data. An event adds `sampleOffset` (Rust:
`sample_offset`) relative to the current audio block, and optional source
information. Host timing must be retained; arbitrary UI callbacks cannot
promise sample-accurate scheduling.

The wire representation contains the original two or three channel-message
bytes. System messages, SysEx, running status, MIDI 2.0, named MIDI buses and
MIDI files are outside this contract.

## Rust processing

`ctx.midi.input()` borrows the current block's ordered events. Input does
not automatically become output. Use `ctx.midi.output().push(event)` for
host output and `ctx.midi.publish(event)` for control-thread observations.
Both return `Result<(), MidiError>`; internal output storage exists even
when host output is disabled.

Each buffer holds **1024 events**. Offsets must be less than the current
block length; only offset zero is accepted in a zero-frame block. Invalid
events are refused, never retimed. Events sort by offset, retaining arrival
order for ties: host events first, then internal messages in successful
enqueue order. If a runtime splits a large block, offsets seen by the
processor are relative to each chunk; output offsets retain the original
block position.

`MidiSender::send(message)` delivers at zero in the next block. Sending is
nonblocking: contention and saturation return `MidiError::Full`; inactive
processors return `MidiError::Inactive`. No JavaScript timer supplies audio
timing. Storage is fixed and the audio path neither allocates nor locks.

Overflow requests `Processor::reset()` before the next block and discards
partial pending input, so a missed release cannot keep a processor voice
active indefinitely. Implement `reset()` to stop all voices. Output
saturation also requests reset; runtime adapters must additionally recover
external notes. `ctx.midi.dropped()` reports cumulative input losses.
Reset and prepare discard pending input and publications; destroying the
processor invalidates all its sender clones.

## Control-thread observations

The processor explicitly calls `ctx.midi.publish(event)`. Each destination
has its own 1024-event queue: a slow UI never consumes or blocks the
controller's events. Observers receive cumulative loss counts and a reset
notification on discontinuity; clear held-note displays or MIDI analysis
state on reset. A discontinuous batch is discarded to avoid unmatched
note events. Reset notifications do not promise a snapshot of sounding voices.

The controller opts in with `const MIDI_INPUT: bool = true` and overrides
`Controller::midi(ctx, batch)`. The existing controller pump runs this
callback on the control thread. `ctx.midi.send(message)` works from both
synchronous and async task contexts, returns an explicit error and never
accesses mutable processor state. Shutdown invalidates detached controller
senders and removes its subscription.

The JavaScript contract exposes `midi.send(message)`, returning `'sent'`,
`'full'` or `'inactive'`. `subscribe(listener, { onReset })` returns an
unsubscribe function; `subscribeBatch(listener)` observes batches directly.
Subscribe only while needed, and unsubscribe in the component's cleanup.
Runtime adapters supply the module's transport and deliver publications
on their control thread; arbitrary JavaScript callbacks have next-block
delivery, without sample scheduling guarantees.

## UI and controller example

```tsx
import { useEffect } from 'react';
import { midi } from 'soundor:midi';

function Monitor() {
  useEffect(
    () =>
      midi.subscribeBatch((batch) => {
        if (batch.reset) clearActiveNotes();
        for (const event of batch.events) observe(event.message);
      }),
    [],
  );
  return null;
}
```

Here `clearActiveNotes` and `observe` are application functions. Keep a bounded
history, and release UI-held notes when the component unmounts. See the
[complete module API](/docs/api/midi).

```rust
impl Controller for PluginController {
    type Local = MyMonitor;
    type Shared = ();
    const MIDI_INPUT: bool = true;
    fn midi(ctx: &mut TaskContext<Self>, batch: soundor::midi::MidiBatch) {
        if batch.reset { ctx.store.local.clear(); }
        for event in batch.events { ctx.store.local.observe(event); }
    }
}
// From a native method, controller callback or async task context:
let result = ctx.midi.send(MidiMessage::NoteOff {
    channel: 1, note: 60, velocity: 0,
});
```

A controller needs no native methods to opt into MIDI. The existing controller
pump delivers callbacks even with the editor closed. Sending is independent of
subscription. The same bounded processor inbox safely accepts multiple UI and
controller producers: a producer makes one atomic acquisition attempt and reports
contention as `Full`; it never waits. Each observer has a separate queue. Native
control-side observer ownership uses a mutex; the audio thread never takes it.

## Web runtime

The Web host's MIDI panel offers **Connect devices**, then separate input and
output selection. Permission is requested only by that action, through
`navigator.requestMIDIAccess({ sysex: false })`. A virtual keyboard using
`soundor:midi` never asks for Web MIDI permission. Unsupported browsers and
permission denial are shown in the panel; virtual/internal input still works.
Web MIDI generally requires a secure context, such as HTTPS or localhost.

Host input/output flags enable the corresponding device selectors. No physical
output is selected automatically. Disconnecting an input resets the processor;
output replacement, suspension and shutdown clear scheduled device output and
send sustain-off/all-sound-off/all-notes-off recovery. Device changes update the
list without silently selecting a different device.

AudioWorklet runs the project's Rust/WASM processor. Input and observation
storage hold 1024 events; the main thread has 1024 input credits and only one
observation batch can be in flight. An acknowledgement releases its capacity.
Lost events trigger reset notifications rather than unlimited buffering.

Physical input timestamps are converted from performance time into the earliest
available 128-frame render quantum. Late messages enter at offset zero; offsets
within the next quantum are retained, and events beyond that window are refused.
Browser message delivery can be late. Arbitrary UI/controller calls always use
next-block timing. This is not a sample-accurate JavaScript sequencer.

Physical output converts processor offsets from the audio clock to Web MIDI's
performance timestamps, using `getOutputTimestamp()` when available. If an output
does not support clearing queued messages, the panel reports immediate delivery;
Soundor avoids leaving uncancellable future Note Ons on that device. Device
latency and browser scheduling still apply. SysEx and MIDI system/realtime
messages are unsupported in this version.

## JUCE plugin and VST3 compatibility

`midi.input` and `midi.output` independently drive the JUCE plugin capability
macros and the VST3 event input/output buses. `kind: 'midiEffect'` defaults to an
empty audio layout, declares the format's MIDI-effect capability and can generate
MIDI without audio outputs. Instruments can declare only an audio output bus.
Internal messages continue to work when both MIDI flags are false.

The adapter preserves host sample offsets and translates channel messages through
JUCE's supported format adapter. VST3 has note-on, note-off and polyphonic-pressure
events; legacy CC output also represents CC, pitch bend, channel pressure and
program output where the receiving host supports it. CC/bend/channel-pressure
input relies on VST3 `IMidiMapping` parameter mapping. Program changes may select
host programs instead of reaching a raw MIDI handler. A DAW can filter messages
or refuse routing between MIDI effects. Soundor does not map every CC to an
author parameter or guarantee all seven types through every VST3 host.

Runtime resets increment a generation. Before subsequent host MIDI output, the
adapter releases the previous generation using sustain-off/all-sound-off. A host
which stops calling process cannot receive additional output until processing
resumes; hosts should release their downstream notes when deactivating a plugin.

## Soundor VST3 host

```ts
import { launchHost, midiInput, midiOutput } from '@soundor/vst3-host';

const host = await launchHost({ plugin: '/path/to/Plugin.vst3' });
try {
  // Virtual input: next processing block, no hardware required.
  await host.sendMidi({ type: 'noteOn', channel: 1, note: 60, velocity: 100 });
  const result = await host.process({
    frames: 512,
    events: [
      midiInput({
        message: { type: 'noteOff', channel: 1, note: 60, velocity: 0 },
        sampleOffset: 127,
      }),
    ],
  });
  const messages = result.events
    .map(midiOutput)
    .filter((event) => event !== null);
  console.log(messages, result.warnings);
  const devices = await host.getMidiInputs();
  if (devices.supported && devices.devices.length)
    await host.selectMidiInput(devices.devices[0].id);
  await host.selectMidiInput(null);
} finally {
  await host.close();
}
```

Virtual injection is supported on every host platform and uses the existing
VST3 event lists and mapped parameter queues. Queue capacity is 1024, overflow
returns `midi-overflow` and resets pending MIDI. Unsupported mappings appear as
warnings rather than disappearing silently. Capture output through
`ProcessResult.events`; unsupported host events remain available there.

Physical input in the standalone host currently uses the Linux ALSA sequencer
and requires `libasound` and an available sequencer device. Select a device
explicitly; no hardware output route is created. Other platforms return
`supported: false` with an explanation. Their VST3 virtual input/output remains
available. Device polling is bounded and uses the existing event loop, separate
from the plugin's capability configuration.

## Examples and verification

- [MIDI Lab](/docs/examples/midi): virtual piano, processor publications and a Rust
  controller monitor, with the same processor in native and Web runtimes.
- [MIDI arpeggiator](/docs/examples/midi-arpeggiator): a chord becomes timed Rust
  MIDI output with no audio buses.

From the repository root:

```sh
pnpm build
pnpm --filter midi --filter midi-arpeggiator typecheck
pnpm --filter midi --filter midi-arpeggiator test
pnpm --filter midi --filter midi-arpeggiator test:rust
pnpm --filter midi --filter midi-arpeggiator build:web
pnpm --filter @soundor/web-runtime test:browser
pnpm --filter @soundor/vst3-host test:native
```

Rust tests count allocations during processing and check offsets across block
sizes, simultaneous notes, Note On zero, release/reset and controller delivery.
SDK/adapter tests also cover overflow, subscriptions, shutdown and disabled MIDI.
Browser tests exercise actual Rust/WASM AudioWorklet delivery; physical hardware
and individual DAW routing require testing on the target machine.
