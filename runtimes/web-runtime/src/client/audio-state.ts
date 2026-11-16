/**
 * The persistent state the plugin's Rust processor reads (soundor.config's
 * `audio: true` fields), as the AudioWorklet's processor gets it: a binary
 * snapshot in describeAudioState()'s layout, the one the JUCE runtime writes
 * and the SDK's StateSnapshot reads.
 *
 * Every change to one of the fields, from any path (a set, History, a
 * restore, a preset), schedules one snapshot of all of them, posted after the
 * changes of the same task: the fields of a transaction or a restore reach
 * the processing together, and changes in between are coalesced. The worklet
 * writes it into the module between render quanta, so a block never sees one
 * partly written.
 */

import {
  describeAudioState,
  writeAudioState,
  type StateStore,
} from '@soundor/runtime-sdk/client';

export interface WebProcessorState {
  /** The snapshot's size in bytes; 0 when the processor reads no state. */
  readonly size: number;
  /** The fields' current values, as a snapshot. */
  snapshot(): Uint8Array;
  /** Calls `listener` once after each batch of changes to the fields. */
  subscribe(listener: () => void): () => void;
}

export function processorState(store: StateStore): WebProcessorState {
  const layout = describeAudioState(store.schema);
  return {
    size: layout.size,
    snapshot: () => {
      const bytes = new Uint8Array(layout.size);
      writeAudioState(
        layout,
        store.snapshot(),
        new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      );
      return bytes;
    },
    subscribe: (listener) => {
      let scheduled = false;
      let active = true;
      const changed = () => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          if (active) listener();
        });
      };
      const stops = layout.fields.map((field) =>
        store.fields[field.name]!.subscribe(changed),
      );
      return () => {
        active = false;
        for (const stop of stops) stop();
      };
    },
  };
}
