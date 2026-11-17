/** MIDI 1.0 messages shared by every runtime. */
declare module 'soundor:midi' {
  /** Channels are 1–16. All data values are integers: 0–127, except bend 0–16383 (centre 8192). */
  export type MidiMessage =
    | {
        type: 'noteOn' | 'noteOff';
        channel: number;
        note: number;
        velocity: number;
      }
    | {
        type: 'controlChange';
        channel: number;
        controller: number;
        value: number;
      }
    | { type: 'pitchBend'; channel: number; value: number }
    | { type: 'programChange'; channel: number; program: number }
    | { type: 'channelPressure'; channel: number; pressure: number }
    | {
        type: 'polyphonicAftertouch';
        channel: number;
        note: number;
        pressure: number;
      };

  /** A message delivered within a processor block; offset is in samples from its start. */
  export interface MidiEvent {
    message: MidiMessage;
    sampleOffset: number;
    /** Origin, when supplied by the runtime. */
    source?: 'host' | 'ui' | 'controller';
  }
}
