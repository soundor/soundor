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
