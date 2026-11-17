---
title: MIDI arpeggiator
description: A Rust sample clock generates host MIDI without producing audio.
---

Source: [`examples/midi-arpeggiator/`](https://github.com/soundor/soundor/tree/main/examples/midi-arpeggiator).
Run commands from that directory after the repository's install/build:

```sh
pnpm dev:web
pnpm dev
pnpm test
pnpm test:rust
pnpm typecheck
pnpm build:web
pnpm build:juce
pnpm test:e2e     # requires the preceding VST3 build
```

The config uses `kind: 'midiEffect'` and enables input/output, with no audio buses
or parameters. The Rust processor holds a bounded channel/note set and emits an
ascending chord at 120 BPM sixteenths. Its sample countdown spans processing
blocks; simultaneous input is applied before the clock step at that sample.
Note Off precedes the next Note On. Note On zero releases a held note; CC 120/123
clear a channel. Reset clears the chord and the runtime releases downstream notes
before subsequent output.

The UI monitor observes explicitly published **output**, rather than echoing
input. This example demonstrates a processor with no native methods and no sound
of its own. Hold notes on a physical MIDI keyboard, or inject a chord using the
VST3 host's `midiInput` helper. In a DAW, route its output to an instrument. In the
Web host, select a physical output explicitly. Without a selected destination,
you can still inspect generated events in the monitor.

`lib/tests/midi.rs` compares exact event times across 64- and 512-frame blocks,
checks zero-velocity release and reset, and counts audio-thread allocations.
`e2e/native.mjs` loads the actual built VST3, injects a chord, checks generated
output offsets and verifies that the plugin has no audio outputs. It needs no
physical MIDI device. Browser and DAW routing limitations are described in
[MIDI](/docs/midi).
