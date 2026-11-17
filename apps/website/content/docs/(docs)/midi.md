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
