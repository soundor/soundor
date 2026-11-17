import type { MidiMessage } from '@soundor/environment/midi-types';

export type { MidiMessage, MidiEvent } from '@soundor/environment/midi-types';

function integer(value: unknown, min: number, max: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw new RangeError(`MIDI: expected integer ${min}–${max}`);
  return value;
}

/** Validates a channel message and encodes its two or three MIDI 1.0 bytes. */
export function encodeMidi(message: MidiMessage): Uint8Array {
  if (typeof message !== 'object' || message === null)
    throw new TypeError('MIDI: expected message');
  const channel = integer(message.channel, 1, 16) - 1;
  const data = (value: unknown) => integer(value, 0, 127);
  switch (message.type) {
    case 'noteOff':
      return Uint8Array.of(
        0x80 | channel,
        data(message.note),
        data(message.velocity),
      );
    case 'noteOn':
      return Uint8Array.of(
        0x90 | channel,
        data(message.note),
        data(message.velocity),
      );
    case 'polyphonicAftertouch':
      return Uint8Array.of(
        0xa0 | channel,
        data(message.note),
        data(message.pressure),
      );
    case 'controlChange':
      return Uint8Array.of(
        0xb0 | channel,
        data(message.controller),
        data(message.value),
      );
    case 'programChange':
      return Uint8Array.of(0xc0 | channel, data(message.program));
    case 'channelPressure':
      return Uint8Array.of(0xd0 | channel, data(message.pressure));
    case 'pitchBend': {
      const value = integer(message.value, 0, 16383);
      return Uint8Array.of(0xe0 | channel, value & 127, value >> 7);
    }
    default:
      throw new TypeError('MIDI: unsupported message type');
  }
}

/** Decodes one complete channel message. Running status and system messages are unsupported. */
export function decodeMidi(bytes: ArrayLike<number>): MidiMessage {
  const status = integer(bytes[0], 0x80, 0xef);
  const kind = status >> 4;
  if (bytes.length !== (kind === 0xc || kind === 0xd ? 2 : 3))
    throw new RangeError('MIDI: incorrect message length');
  const a = integer(bytes[1], 0, 127);
  const b = bytes.length === 3 ? integer(bytes[2], 0, 127) : 0;
  const channel = (status & 15) + 1;
  switch (kind) {
    case 8:
      return { type: 'noteOff', channel, note: a, velocity: b };
    case 9:
      return { type: 'noteOn', channel, note: a, velocity: b };
    case 10:
      return { type: 'polyphonicAftertouch', channel, note: a, pressure: b };
    case 11:
      return { type: 'controlChange', channel, controller: a, value: b };
    case 12:
      return { type: 'programChange', channel, program: a };
    case 13:
      return { type: 'channelPressure', channel, pressure: a };
    default:
      return { type: 'pitchBend', channel, value: a | (b << 7) };
  }
}
