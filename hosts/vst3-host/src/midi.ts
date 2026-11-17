/** MIDI 1.0 adapter for the host's existing VST3 events/parameter mappings. */
import { encodeMidi } from '@soundor/core/midi';
import type { MidiEvent, MidiMessage } from '@soundor/core/midi';

import type { InputEvent, OutputEvent } from './types.ts';
export type { MidiEvent, MidiMessage } from '@soundor/core/midi';

/** Converts integer, one-based MIDI into VST3's channel/event conventions. */
export function midiInput(event: MidiEvent): InputEvent {
  encodeMidi(event.message);
  if (!Number.isSafeInteger(event.sampleOffset) || event.sampleOffset < 0)
    throw new RangeError('MIDI: invalid sample offset');
  const message = event.message;
  const base = {
    channel: message.channel - 1,
    bus: 0,
    time: event.sampleOffset,
  };
  switch (message.type) {
    case 'noteOn':
    case 'noteOff':
      return {
        ...base,
        type: message.type,
        pitch: message.note,
        velocity: message.velocity / 127,
      };
    case 'controlChange':
      return {
        ...base,
        type: message.type,
        controller: message.controller,
        value: message.value / 127,
      };
    case 'pitchBend':
      return {
        ...base,
        type: message.type,
        value: (2 * message.value) / 16383 - 1,
      };
    case 'programChange':
      return { ...base, type: message.type, program: message.program };
    case 'channelPressure':
      return { ...base, type: message.type, value: message.pressure / 127 };
    case 'polyphonicAftertouch':
      return {
        ...base,
        type: 'polyPressure',
        pitch: message.note,
        pressure: message.pressure / 127,
      };
  }
}
/** Converts representable VST3 output. Null identifies a non-MIDI/unsupported
 * host event, which remains available in ProcessResult.events. */
export function midiOutput(event: OutputEvent): MidiEvent | null {
  if (event.type === 'other' || event.bus !== 0) return null;
  const channel = event.channel + 1;
  const value = (normalized: number) => Math.round(normalized * 127);
  let message: MidiMessage;
  if (event.type === 'noteOn' || event.type === 'noteOff')
    message = {
      type: event.type,
      channel,
      note: event.pitch,
      velocity: value(event.velocity),
    };
  else if (event.type === 'polyPressure')
    message = {
      type: 'polyphonicAftertouch',
      channel,
      note: event.pitch,
      pressure: value(event.pressure),
    };
  else if (event.type === 'midiCC') {
    if (event.controller < 128)
      message = {
        type: 'controlChange',
        channel,
        controller: event.controller,
        value: event.value,
      };
    else if (event.controller === 128)
      message = { type: 'channelPressure', channel, pressure: event.value };
    else if (event.controller === 129)
      message = {
        type: 'pitchBend',
        channel,
        value: event.value | (event.value2 << 7),
      };
    else if (event.controller === 130)
      message = { type: 'programChange', channel, program: event.value };
    else return null;
  } else return null;
  encodeMidi(message);
  return { message, sampleOffset: event.time, source: 'host' };
}
