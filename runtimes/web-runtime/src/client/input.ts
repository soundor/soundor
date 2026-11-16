import { validateBuiltinInput, type BuiltinInput } from '../input-options';
import type { WebAudioInput } from './audio';

export type { BuiltinInput } from '../input-options';
export type {
  WebAudioInput,
  WebAudioInputContext,
  WebAudioCleanup,
  WebAudioInputInfo,
} from './audio';

/** A built-in definition or a custom source using the host's existing playback lifecycle. */
export type WebInput = BuiltinInput | WebAudioInput;

/** Type-checks a custom source without changing its behavior. */
export function defineInput<T extends WebAudioInput>(input: T): T {
  return input;
}

/** A triangle at 220 Hz and gain 0.3 by default. */
export function oscillator(
  options: Omit<Extract<BuiltinInput, { type: 'oscillator' }>, 'type'> = {},
): BuiltinInput {
  return { type: 'oscillator', ...options };
}
/** The host's audio file picker and looping playback. */
export function audioFile(): BuiltinInput {
  return { type: 'file' };
}
/** Capture starts only after explicit selection and a browser permission gesture. */
export function microphone(): BuiltinInput {
  return { type: 'microphone' };
}

/** Validates browser exports before audio or controller resources are allocated. */
export function validateInputs(value: unknown): readonly WebInput[] {
  if (!Array.isArray(value))
    throw new TypeError('Web inputs must be a default-exported array');
  const ids = new Set(['none']);
  for (const input of value as unknown[]) {
    if (input === null || typeof input !== 'object')
      throw new TypeError('Invalid web input: expected an object');
    let id: string;
    if ('type' in input) {
      validateBuiltinInput(input);
      id = input.type;
    } else {
      const custom = input as WebAudioInput;
      id = custom.id;
      if (typeof id !== 'string' || !id.trim())
        throw new TypeError('Audio input needs a nonempty id');
      if (['oscillator', 'file', 'microphone'].includes(id))
        throw new TypeError(`Reserved audio input id: ${id}`);
      if (
        typeof custom.label !== 'string' ||
        !custom.label.trim() ||
        typeof custom.start !== 'function'
      )
        throw new TypeError(
          `Audio input ${id} needs a label and start function`,
        );
    }
    if (ids.has(id)) throw new TypeError(`Duplicate audio input id: ${id}`);
    ids.add(id);
  }
  return value as readonly WebInput[];
}
