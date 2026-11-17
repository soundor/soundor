---
title: soundor:midi
description: Send MIDI to Rust and observe explicit processor publications.
---

```ts
import { midi, type MidiMessage, type MidiEvent } from 'soundor:midi';

const result = midi.send({
  type: 'noteOn',
  channel: 1,
  note: 60,
  velocity: 100,
});
// result: 'sent' | 'full' | 'inactive'
const unsubscribe = midi.subscribe(
  (event) => console.log(event.message, event.sampleOffset, event.source),
  { onReset: (dropped) => console.log('Clear held-note display', dropped) },
);
// When the view/component is removed:
unsubscribe();
```

`send(message)` validates integers and returns immediately. Invalid messages
throw `RangeError`; unsupported message types throw. A successful send queues
an event for offset zero of the next available processing block. It does not
schedule against a wall clock. A suspended, stopped or destroyed runtime
returns `'inactive'`; a saturated queue returns `'full'` and requests recovery.
Do not retry indefinitely or schedule real-time notes using JavaScript timers.

Messages use channels **1–16**, notes/velocities/controllers/programs/pressures
**0–127**, and pitch bend **0–16383**, with centre **8192**. Supported types:

| Type                   | Additional fields     |
| ---------------------- | --------------------- |
| `noteOn`, `noteOff`    | `note`, `velocity`    |
| `controlChange`        | `controller`, `value` |
| `pitchBend`            | `value`               |
| `programChange`        | `program`             |
| `channelPressure`      | `pressure`            |
| `polyphonicAftertouch` | `note`, `pressure`    |

Note On velocity zero is preserved. A synth normally treats it as a release.

`subscribe(listener, { onReset? })` observes only `ctx.midi.publish(event)`
in Rust. Input and host output are not implicitly broadcast. `MidiEvent`
contains `message`, `sampleOffset` and optional `source` (`'host'`, `'ui'`,
`'controller'`). The offset belongs to the original processing block, including
when observations are batched across several blocks; it is not a browser time.

`subscribeBatch(listener)` delivers `{ events, dropped, reset }`. Events
retain order. `dropped` is a cumulative loss count for that observation path.
On `reset`, discard held-note/analysis state; a discontinuous batch is discarded.
No authoritative snapshot of sounding voices is provided. Observation queues
hold 1024 events, native editor fanout holds eight batches, and an API instance
allows at most 128 subscriptions. Remove subscriptions in React effect cleanup.
The last unsubscribe releases the runtime's observation endpoint.

Callbacks run on the UI thread, outside audio processing. Keep callbacks short;
exceptions are reported without preventing other subscribers from receiving.
Internal sends and subscriptions work with both host MIDI capabilities disabled.
See [MIDI](/docs/midi) for Rust, hardware routing, timing and format limitations.
