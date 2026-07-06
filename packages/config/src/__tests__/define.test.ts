import { describe, expect, expectTypeOf, it } from 'vitest';

import { defineSoundorConfig } from '../index';

describe('defineSoundorConfig', () => {
  const config = defineSoundorConfig({
    runtimes: [{ id: 'juce', options: { format: 'vst3' } }],
    parameters: [
      {
        type: 'float',
        id: 'gain',
        label: 'Gain',
        min: 0,
        max: 1,
        default: 0.5,
      },
      { type: 'bool', id: 'bypass', label: 'Bypass', default: false },
    ],
    nativeMethods: [{ name: 'render', input: 'Request', output: 'Result' }],
  });

  it('returns the config unchanged', () => {
    expect(config.runtimes[0].id).toBe('juce');
    expect(config.parameters).toHaveLength(2);
  });

  it('preserves parameter ids as string literals', () => {
    // `const` inference pins the literal ids so downstream codegen can read them.
    expectTypeOf(config.parameters[0].id).toEqualTypeOf<'gain'>();
    expectTypeOf(config.runtimes[0].id).toEqualTypeOf<'juce'>();
  });

  it('rejects an invalid parameter shape at author time', () => {
    const authored = defineSoundorConfig({
      runtimes: [],
      parameters: [
        {
          type: 'float',
          id: 'gain',
          label: 'Gain',
          min: 0,
          max: 10,
          default: 2,
        },
      ],
    });
    expect(authored.parameters).toHaveLength(1);
  });
});
