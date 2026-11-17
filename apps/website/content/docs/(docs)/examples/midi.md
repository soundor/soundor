---
title: MIDI Lab
description: A virtual piano, MIDI monitor and Rust controller in native and Web runtimes.
---

Source: [`examples/midi/`](https://github.com/soundor/soundor/tree/main/examples/midi).
Run the following commands from that directory after `pnpm install` and
`pnpm build` at the repository root:

```sh
pnpm dev:web      # browser host; start audio, then hold a piano key
pnpm dev          # VST3 in the Soundor host
pnpm test         # key press/release, panic and unmount behavior
pnpm test:rust    # sample offsets, reset, controller transport, allocation counts
pnpm typecheck
pnpm build:web
pnpm test:web    # Chromium, also needs midi-arpeggiator build:web
pnpm build:juce
```

The UI sends Note On/Off via `soundor:midi`. The same `PluginProcessor` in
`lib/src/lib.rs` runs natively and as WASM: a bounded 16-voice sine synth applies
each note at its sample offset, publishes the event to observers, and writes
stereo audio. It preserves Note On zero in the monitor while releasing the voice.
This is a small demonstration synth, without envelopes or sustain-pedal behavior;
reset and CC 120/123 stop voices. It does not automatically echo MIDI to the host.

The monitor keeps eight events and clears active-note state after discontinuity.
The keyboard releases held notes and removes its subscription on unmount.
**Hold controller C** sends through a Rust controller native method. **Read
controller monitor** reads its explicitly opted-in event count; the MIDI callback
runs from the controller pump, outside audio processing. No JavaScript timer
schedules notes.

The config enables host input and disables host output. UI and controller
communication still work. In the Web host, a virtual piano needs no Web MIDI
permission. Use the MIDI panel to connect/select a physical input explicitly.
See [MIDI](/docs/midi) for delivery timing, overflow and VST3 compatibility.

For a real native audio test, build the VST3 and run:

```sh
pnpm test:e2e
```

The test loads the built plugin in the Soundor VST3 host and checks sample-timed
note onset, release and reset without requiring an audio device or editor.
