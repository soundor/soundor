/** Built-in sources for the Web host's Input selector. Explicit lists replace defaults. */
export type BuiltinInput =
  | {
      readonly type: 'oscillator';
      /** Oscillator shape; triangle by default. */
      readonly waveform?: 'sine' | 'square' | 'sawtooth' | 'triangle';
      /** Frequency in Hz, positive and finite; 220 by default. */
      readonly frequency?: number;
      /** Linear source gain between 0 and 1; 0.3 by default. */
      readonly gain?: number;
    }
  | { readonly type: 'file' }
  | { readonly type: 'microphone' };

/** The existing default sources, in selector order. No input is always available. */
export const defaultInputs: readonly BuiltinInput[] = [
  { type: 'oscillator' },
  { type: 'file' },
  { type: 'microphone' },
];

/** Shared by config validation and browser input modules. */
export function validateBuiltinInput(
  value: unknown,
): asserts value is BuiltinInput {
  if (value === null || typeof value !== 'object' || !('type' in value))
    throw new TypeError('Expected a built-in input definition with a type');
  const input = value as Record<string, unknown>;
  const keys =
    input.type === 'oscillator'
      ? ['type', 'waveform', 'frequency', 'gain']
      : ['type'];
  if (!['oscillator', 'file', 'microphone'].includes(String(input.type)))
    throw new TypeError(`Unknown built-in input type: ${String(input.type)}`);
  for (const key of Object.keys(input))
    if (!keys.includes(key))
      throw new TypeError(`Unknown ${String(input.type)} input option: ${key}`);
  if (
    input.waveform !== undefined &&
    !['sine', 'square', 'sawtooth', 'triangle'].includes(String(input.waveform))
  )
    throw new TypeError(
      'Oscillator waveform must be sine, square, sawtooth or triangle',
    );
  if (
    input.frequency !== undefined &&
    (typeof input.frequency !== 'number' ||
      !Number.isFinite(input.frequency) ||
      input.frequency <= 0)
  )
    throw new TypeError(
      'Oscillator frequency must be a finite positive number',
    );
  if (
    input.gain !== undefined &&
    (typeof input.gain !== 'number' ||
      !Number.isFinite(input.gain) ||
      input.gain < 0 ||
      input.gain > 1)
  )
    throw new TypeError('Oscillator gain must be between 0 and 1');
}
