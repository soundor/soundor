import { assertType, describe, expect, expectTypeOf, it } from 'vitest';

import { defineSoundorConfig } from './index';
import type {
  BoolParameter,
  EnumParameter,
  FloatParameter,
  IntParameter,
  NativeMethod,
  Parameter,
} from './index';

describe('parameter variants', () => {
  it('accepts a float parameter', () => {
    const param: FloatParameter = {
      type: 'float',
      id: 'gain',
      label: 'Gain',
      min: 0,
      max: 1,
      default: 0.5,
      unit: 'dB',
    };
    assertType<Parameter>(param);
    expect(param.type).toBe('float');
  });

  it('accepts an int parameter', () => {
    const param: IntParameter = {
      type: 'int',
      id: 'voices',
      label: 'Voices',
      min: 1,
      max: 16,
      default: 4,
    };
    assertType<Parameter>(param);
    expect(param.default).toBe(4);
  });

  it('accepts a bool parameter', () => {
    const param: BoolParameter = {
      type: 'bool',
      id: 'bypass',
      label: 'Bypass',
      default: false,
    };
    assertType<Parameter>(param);
    expect(param.default).toBe(false);
  });

  it('accepts an enum parameter with an onChange hook', () => {
    const param: EnumParameter = {
      type: 'enum',
      id: 'mode',
      label: 'Mode',
      values: ['mono', 'stereo'],
      default: 'stereo',
      onChange: 'onModeChange',
    };
    assertType<Parameter>(param);
    expect(param.values).toHaveLength(2);
  });

  it('discriminates the parameter union on `type`', () => {
    const param = {
      type: 'float',
      id: 'gain',
      label: 'Gain',
      min: 0,
      max: 1,
      default: 0.5,
    } as Parameter;
    if (param.type === 'enum') {
      expectTypeOf(param).toEqualTypeOf<EnumParameter>();
    }
  });
});

describe('malformed shapes are rejected at the type level', () => {
  it('rejects an unknown parameter type', () => {
    // @ts-expect-error 'ratio' is not a declared parameter type
    const param: Parameter = { type: 'ratio', id: 'x', label: 'X' };
    expect(param).toBeDefined();
  });

  it('rejects a float parameter missing `min`', () => {
    // @ts-expect-error float requires `min`
    const param: FloatParameter = {
      type: 'float',
      id: 'g',
      label: 'G',
      max: 1,
      default: 0,
    };
    expect(param).toBeDefined();
  });

  it('rejects a bool parameter with a non-boolean default', () => {
    const param: BoolParameter = {
      type: 'bool',
      id: 'b',
      label: 'B',
      // @ts-expect-error bool default must be a boolean
      default: 'nope',
    };
    expect(param).toBeDefined();
  });

  it('rejects an enum parameter missing `values`', () => {
    // @ts-expect-error enum requires `values`
    const param: EnumParameter = {
      type: 'enum',
      id: 'm',
      label: 'M',
      default: 'a',
    };
    expect(param).toBeDefined();
  });
});

describe('native methods', () => {
  it('declares name, input, and output', () => {
    const method: NativeMethod = {
      name: 'render',
      input: 'RenderRequest',
      output: 'RenderResult',
    };
    expect(method.name).toBe('render');
  });
});

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
      // @ts-expect-error float parameter is missing `max` and `default`
      parameters: [{ type: 'float', id: 'gain', label: 'Gain', min: 0 }],
    });
    expect(authored.parameters).toHaveLength(1);
  });
});
