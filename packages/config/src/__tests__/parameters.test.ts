import { compileJsFunction } from '@soundor/expression/compiler/js';
import { describe, expect, it } from 'vitest';

import { ConfigError } from '../errors';
import { semanticsInputs, type ResolvedParameter } from '../parameters';
import { validateConfig } from '../schema';

const plugin = { id: 'com.example.test', name: 'Test' };

function resolve(
  parameters: Record<string, unknown>,
): readonly ResolvedParameter[] {
  return validateConfig({ plugin, runtimes: [], parameters }).parameters;
}

function parameter(declaration: unknown): ResolvedParameter {
  return resolve({ p: declaration })[0]!;
}

function issues(declaration: unknown): { path: string; message: string }[] {
  try {
    resolve({ p: declaration });
  } catch (error) {
    if (error instanceof ConfigError)
      return error.issues.map(({ path, message }) => ({ path, message }));
    throw error;
  }
  return [];
}

/** The parameter's behavior, compiled to JavaScript as the Web runtime does. */
function behavior(declaration: unknown) {
  const p = parameter(declaration);
  const inputs = semanticsInputs(p.semantics.valueType);
  const fn = (expression: unknown, i: Record<string, string>) =>
    compileJsFunction(expression, i as never) as (x: unknown) => unknown;
  return {
    parameter: p,
    toValue: fn(p.semantics.toValue, inputs.toValue) as (t: number) => number,
    toNormalized: fn(p.semantics.toNormalized, inputs.toNormalized) as (
      v: number,
    ) => number,
    constrain: fn(p.semantics.constrain, inputs.constrain) as (
      v: number,
    ) => number,
    format: fn(p.semantics.format, inputs.format) as (v: number) => string,
    parse: fn(p.semantics.parse, inputs.parse) as (
      text: string,
    ) => number | null,
  };
}

const f32 = Math.fround;
const steps = (n: number) => Array.from({ length: n + 1 }, (_, i) => i / n);

/** Even's ranges: what a real equalizer needs. */
const even = {
  frequency: {
    type: 'float32',
    label: 'Frequency',
    min: 20,
    max: 20000,
    default: 1000,
    mapping: 'log',
    unit: 'Hz',
  },
  q: {
    type: 'float32',
    label: 'Q',
    min: 0.1,
    max: 30,
    default: 1,
    mapping: 'log',
  },
  gain: {
    type: 'float32',
    label: 'Gain',
    min: -24,
    max: 24,
    default: 0,
    step: 0.01,
    unit: 'dB',
  },
} as const;

describe('mappings', () => {
  it('linear: endpoints, midpoint, clamping, inverse', () => {
    const p = behavior({ type: 'float32', min: -1, max: 3, default: 0 });
    expect(p.parameter).toMatchObject({ mapping: { type: 'linear' } });
    expect([p.toValue(0), p.toValue(0.5), p.toValue(1)]).toEqual([-1, 1, 3]);
    expect([p.toValue(-5), p.toValue(7)]).toEqual([-1, 3]);
    expect([p.toNormalized(-1), p.toNormalized(1), p.toNormalized(3)]).toEqual([
      0, 0.5, 1,
    ]);
  });

  it('log: Even frequency', () => {
    const p = behavior(even.frequency);
    expect(p.toValue(0)).toBe(20);
    expect(p.toValue(1)).toBe(20000);
    expect(p.toValue(0.5)).toBe(f32(Math.sqrt(20 * 20000)));
    expect(p.toValue(1 / 3)).toBeCloseTo(200, 3);
    expect(p.toNormalized(1000)).toBeCloseTo(Math.log(50) / Math.log(1000), 7);
    expect([p.toNormalized(20), p.toNormalized(20000)]).toEqual([0, 1]);
    let previous = -Infinity;
    for (const t of steps(1000)) {
      const value = p.toValue(t);
      expect(f32(value)).toBe(value);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(Math.abs(p.toNormalized(value) - t)).toBeLessThan(1e-6);
      previous = value;
    }
  });

  it('log: Even Q, with a min no float32 holds exactly', () => {
    const p = behavior(even.q);
    expect(p.toValue(0)).toBe(f32(0.1));
    expect(p.toValue(1)).toBe(30);
    expect(p.constrain(1)).toBe(1);
    expect(p.toNormalized(f32(0.1))).toBeCloseTo(0, 6);
    expect(p.toValue(p.toNormalized(1))).toBeCloseTo(1, 6);
  });

  it('power', () => {
    const p = behavior({
      type: 'float32',
      min: 0,
      max: 100,
      default: 0,
      mapping: { type: 'power', exponent: 2 },
    });
    expect(p.toValue(0.5)).toBe(25);
    expect(p.toNormalized(25)).toBeCloseTo(0.5, 7);
    expect(p.toNormalized(100)).toBe(1);
  });

  it('symmetric power: midpoint at the range midpoint, symmetric halves', () => {
    const p = behavior({
      type: 'float32',
      min: -24,
      max: 24,
      default: 0,
      mapping: { type: 'symmetricPower', exponent: 3 },
    });
    expect(p.toValue(0.5)).toBe(0);
    expect([p.toValue(0), p.toValue(1)]).toEqual([-24, 24]);
    expect(p.toValue(0.25)).toBeCloseTo(-24 + 48 * 0.5 * 0.5 ** 3, 5);
    expect(p.toValue(0.25)).toBeCloseTo(-p.toValue(0.75), 5);
    for (const t of steps(64))
      expect(p.toNormalized(p.toValue(t))).toBeCloseTo(t, 6);
  });

  it('rejects invalid domains and exponents', () => {
    expect(
      issues({ type: 'float32', min: 0, max: 1, default: 0.5, mapping: 'log' }),
    ).toEqual([
      {
        path: 'parameters.p.mapping',
        message: 'a log mapping needs min above 0, got 0',
      },
    ]);
    for (const exponent of [0, -1, Infinity, Number.NaN, '2'])
      expect(
        issues({
          type: 'float32',
          min: 0,
          max: 1,
          default: 0,
          mapping: { type: 'power', exponent },
        }),
      ).toEqual([
        {
          path: 'parameters.p.mapping.exponent',
          message: 'the exponent is a finite number above 0',
        },
      ]);
    expect(
      issues({
        type: 'float32',
        min: 0,
        max: 1,
        default: 0,
        mapping: 'exponential',
      })[0]?.path,
    ).toBe('parameters.p.mapping');
    expect(
      issues({ type: 'int16', min: 1, max: 100, default: 1, mapping: 'log' })[0]
        ?.message,
    ).toContain("an 'int16' parameter is linear");
  });

  describe('custom', () => {
    const square = {
      type: 'custom',
      toValue: (e: any) => e.mul(e.normalized, e.normalized),
      toNormalized: (e: any) => e.sqrt(e.value),
    };

    it('works through typed expressions', () => {
      const p = behavior({
        type: 'float32',
        min: 0,
        max: 1,
        default: 0.25,
        mapping: square,
      });
      expect(p.parameter).toMatchObject({ mapping: { type: 'custom' } });
      expect(p.toValue(0.5)).toBe(0.25);
      expect(p.toNormalized(0.25)).toBe(0.5);
    });

    it('is checked numerically', () => {
      const wrongEnd = {
        ...square,
        toValue: (e: any) => e.mul(e.normalized, 0.5),
      };
      expect(
        issues({
          type: 'float32',
          min: 0,
          max: 1,
          default: 0,
          mapping: wrongEnd,
        })[0],
      ).toEqual({
        path: 'parameters.p.mapping.toValue',
        message:
          'toValue must map 0 to min (0) and 1 to max (1); it gives 0 and 0.5',
      });
      const decreasing = {
        type: 'custom',
        toValue: (e: any) =>
          e.if(
            e.lt(e.normalized, 0.5),
            e.sub(e.float64(0.5), e.normalized),
            e.normalized,
          ),
        toNormalized: (e: any) => e.value,
      };
      expect(
        issues({
          type: 'float32',
          min: 0,
          max: 1,
          default: 0,
          mapping: {
            ...decreasing,
            toValue: (e: any) =>
              e.if(e.lte(e.normalized, 0), e.float64(0), decreasing.toValue(e)),
          },
        })[0]?.message,
      ).toMatch(/^toValue must increase/);
      const notInverse = { ...square, toNormalized: (e: any) => e.value };
      expect(
        issues({
          type: 'float32',
          min: 0,
          max: 1,
          default: 0,
          mapping: notInverse,
        })[0],
      ).toMatchObject({
        path: 'parameters.p.mapping.toNormalized',
        message: expect.stringMatching(/^toNormalized does not invert toValue/),
      });
      const wrongType = {
        ...square,
        toValue: (e: any) => e.convert(e.normalized, 'float32'),
      };
      expect(
        issues({
          type: 'float32',
          min: 0,
          max: 1,
          default: 0,
          mapping: wrongType,
        })[0],
      ).toEqual({
        path: 'parameters.p.mapping.toValue',
        message: "expected an expression of type 'float64', got 'float32'",
      });
      const throws = {
        ...square,
        toValue: (e: any) => e.add(e.normalized, e.int32(1)),
      };
      expect(
        issues({
          type: 'float32',
          min: 0,
          max: 1,
          default: 0,
          mapping: throws,
        })[0]?.message,
      ).toContain(
        'building the expression failed: add() takes operands of one type',
      );
      expect(
        issues({
          type: 'float32',
          min: 0,
          max: 1,
          default: 0,
          mapping: { type: 'custom', toValue: square.toValue },
        })[0]?.path,
      ).toBe('parameters.p.mapping.toNormalized');
    });
  });
});

describe('steps', () => {
  it('snap actual values from min: Even gain', () => {
    const p = behavior(even.gain);
    expect(p.constrain(1.234)).toBe(f32(1.23));
    expect(p.constrain(-1.236)).toBe(f32(-1.24));
    // A tie goes up: steps count from min.
    expect(p.constrain(-1.235)).toBe(f32(-1.23));
    expect(p.constrain(30)).toBe(24);
    expect(p.constrain(-30)).toBe(-24);
    expect(p.toValue(0.5)).toBe(0);
    expect(p.toValue(0.51)).toBe(f32(0.48));
    expect(p.toNormalized(0)).toBe(0.5);
    // Every step of the grid, from automation, is a value the grid holds.
    for (const t of steps(4800)) {
      const value = p.toValue(t);
      expect(Math.abs(value * 100 - Math.round(value * 100))).toBeLessThan(
        1e-3,
      );
    }
  });

  it('end at max when the range is not a whole number of steps', () => {
    const p = behavior({
      type: 'float32',
      min: 0,
      max: 1,
      default: 0.3,
      step: 0.3,
    });
    expect(p.constrain(0.92)).toBe(f32(0.9));
    expect(p.constrain(0.96)).toBe(1);
    expect(p.constrain(0.4)).toBe(f32(0.3));
    expect(p.toValue(1)).toBe(1);
  });

  it('quantize integers, which are linear and evenly stepped', () => {
    const p = behavior({
      type: 'int16',
      min: -10,
      max: 10,
      default: 0,
      step: 2,
    });
    expect(p.toValue(0.5)).toBe(0);
    expect(p.toValue(0.55)).toBe(2);
    expect(p.constrain(3)).toBe(4);
    expect(p.constrain(-100)).toBe(-10);
    expect(p.toNormalized(4)).toBeCloseTo(0.7, 12);
    // As JUCE's AudioParameterInt: min + round(t · span).
    const voices = behavior({ type: 'uint8', min: 1, max: 16, default: 4 });
    expect(steps(100).map((t) => voices.toValue(t))).toEqual(
      steps(100).map((t) => 1 + Math.floor(t * 15 + 0.5)),
    );
  });

  it('are validated', () => {
    for (const step of [0, -1, Infinity])
      expect(
        issues({ type: 'float32', min: 0, max: 1, default: 0, step })[0],
      ).toEqual({
        path: 'parameters.p.step',
        message: 'a step is a finite number above 0',
      });
    expect(
      issues({ type: 'int32', min: 0, max: 10, default: 0, step: 3 })[0]
        ?.message,
    ).toContain('must divide the range (10)');
    expect(
      issues({ type: 'int32', min: 0, max: 10, default: 0, step: 0.5 })[0]
        ?.message,
    ).toContain('is an integer');
    expect(
      issues({ type: 'float32', min: 0, max: 1, default: 0, step: 2 })[0]
        ?.message,
    ).toContain('larger than the range');
    expect(
      issues({ type: 'float32', min: 0, max: 1, default: 0.5, step: 0.3 }),
    ).toEqual([
      {
        path: 'parameters.p.default',
        message: `default (0.5) is not a legal value: with step 0.3 from 0, the nearest is ${f32(0.6)}`,
      },
    ]);
  });
});

describe('text', () => {
  it('formats and parses Even gain with its unit', () => {
    const p = behavior(even.gain);
    expect(p.format(-3.5)).toBe('-3.50 dB');
    expect(p.format(f32(-0.004))).toBe('0.00 dB');
    expect(p.parse('-3.50 dB')).toBe(-3.5);
    expect(p.parse(' -3.5 DB ')).toBe(-3.5);
    expect(p.parse('-3.5')).toBe(-3.5);
    expect(p.parse('1.234')).toBe(f32(1.23));
    expect(p.parse('30 dB')).toBeNull();
    expect(p.parse('loud')).toBeNull();
    expect(p.parse('')).toBeNull();
  });

  it('chooses default decimals from the step or range', () => {
    expect(
      behavior({ type: 'float32', min: 0, max: 1, default: 0.5 }).format(0.5),
    ).toBe('0.500');
    expect(behavior(even.frequency).format(1000)).toBe('1000 Hz');
    expect(behavior(even.q).format(1)).toBe('1.0');
    expect(
      behavior({
        type: 'float32',
        min: 0,
        max: 10,
        default: 0,
        step: 0.25,
      }).format(2.5),
    ).toBe('2.50');
    expect(
      behavior({
        type: 'int32',
        min: 1,
        max: 32,
        default: 8,
        unit: 'voices',
      }).format(8),
    ).toBe('8 voices');
  });

  it('formats and parses a frequency in kHz', () => {
    const p = behavior({
      ...even.frequency,
      format: (e: any) =>
        e.if(
          e.gte(e.value, 1000),
          e.concat(e.fixed(e.div(e.value, 1000), 2), ' kHz'),
          e.concat(e.fixed(e.value, 0), ' Hz'),
        ),
      parse: (e: any) =>
        e.let(e.lower(e.trim(e.text)), (text: any) =>
          e.if(
            e.endsWith(text, 'khz'),
            e.map(e.parseFloat32(e.removeSuffix(text, 'khz')), (v: any) =>
              e.mul(v, 1000),
            ),
            e.parseFloat32(e.removeSuffix(text, 'hz')),
          ),
        ),
    });
    expect(p.format(1250)).toBe('1.25 kHz');
    expect(p.format(500)).toBe('500 Hz');
    expect(p.parse('1.25 kHz')).toBe(1250);
    expect(p.parse('500 Hz')).toBe(500);
    expect(p.parse('500')).toBe(500);
    expect(p.parse('25 kHz')).toBeNull();
    expect(p.parse('invalid')).toBeNull();
  });

  it('needs a parse for a custom format, which must read what it writes', () => {
    const percent = (e: any) => e.concat(e.fixed(e.mul(e.value, 100), 0), '%');
    expect(
      issues({ type: 'float32', min: 0, max: 1, default: 0, format: percent }),
    ).toEqual([
      {
        path: 'parameters.p.parse',
        message:
          "a custom format needs a parse that reads what it writes, or parse: 'default' for the number parser",
      },
    ]);
    expect(
      issues({
        type: 'float32',
        min: 0,
        max: 1,
        default: 0,
        format: percent,
        parse: 'default',
      })[0],
    ).toEqual({
      path: 'parameters.p.format',
      message:
        "parse does not read what format writes: format(0) is '0%', which parse rejects",
    });
    const p = behavior({
      type: 'float32',
      min: 0,
      max: 1,
      default: 0,
      format: percent,
      parse: (e: any) =>
        e.map(e.parseFloat32(e.removeSuffix(e.trim(e.text), '%')), (v: any) =>
          e.div(v, 100),
        ),
    });
    expect([p.format(0.75), p.parse('75%')]).toEqual(['75%', 0.75]);
    expect(
      issues({
        type: 'int32',
        min: 0,
        max: 10,
        default: 0,
        parse: (e: any) => e.parseFloat32(e.text),
      })[0],
    ).toEqual({
      path: 'parameters.p.parse',
      message: "expected an expression of type 'int32?', got 'float32?'",
    });
  });
});

describe('choices and booleans', () => {
  const filterType = {
    type: 'choice',
    label: 'Filter Type',
    options: [
      { value: 'bell', label: 'Bell' },
      { value: 'lowpass', label: 'Low Pass' },
      { value: 'highpass', label: 'High Pass' },
    ],
    default: 'bell',
  };

  it('map options to evenly spaced indices, as hosts store them', () => {
    const p = behavior(filterType);
    expect(p.parameter.semantics.valueType).toBe('uint32');
    expect([0, 0.24, 0.26, 0.5, 0.74, 0.76, 1].map(p.toValue)).toEqual([
      0, 0, 1, 1, 1, 2, 2,
    ]);
    expect([0, 1, 2].map(p.toNormalized)).toEqual([0, 0.5, 1]);
    expect([-1, 0.4, 1.6, 9].map(p.constrain)).toEqual([0, 0, 2, 2]);
  });

  it('format labels and parse labels or values, in any case', () => {
    const p = behavior(filterType);
    expect([0, 1, 2].map(p.format)).toEqual(['Bell', 'Low Pass', 'High Pass']);
    expect(['Low Pass', 'lowpass', ' HIGH PASS ', 'bell'].map(p.parse)).toEqual(
      [1, 1, 2, 0],
    );
    expect(p.parse('notch')).toBeNull();
  });

  it('reject options that could not be told apart', () => {
    const options = (list: unknown[]) =>
      issues({ type: 'choice', options: list, default: 'a' });
    expect(
      options([
        { value: 'a', label: 'A' },
        { value: 'a', label: 'B' },
      ])[0],
    ).toMatchObject({
      path: 'parameters.p.options[1].value',
    });
    expect(
      options([
        { value: 'a', label: 'Same' },
        { value: 'b', label: 'same' },
      ])[0],
    ).toEqual({
      path: 'parameters.p.options[1].label',
      message:
        "label 'same' is the same text as option 0's label 'Same' (ignoring case), so typed text could not tell them apart",
    });
    expect(
      options([
        { value: 'a', label: 'B' },
        { value: 'b', label: 'C' },
      ])[0]?.path,
    ).toBe('parameters.p.options[1].value');
    expect(options([])[0]?.message).toContain('at least one option');
    expect(options(['a'])[0]?.message).toContain(
      'a string alone is not accepted',
    );
    expect(options([{ value: '', label: 'A' }])[0]?.message).toBe(
      'expected a non-empty value',
    );
    expect(options([{ value: 'a', label: '' }])[0]?.message).toBe(
      'expected a non-empty label',
    );
    expect(options([{ value: 'a', label: 'A', color: 'red' }])[0]?.path).toBe(
      'parameters.p.options[0].color',
    );
    expect(issues({ ...filterType, default: 'notch' })).toEqual([
      {
        path: 'parameters.p.default',
        message:
          "default \"notch\" is not one of the options' values ['bell', 'lowpass', 'highpass']",
      },
    ]);
  });

  it('booleans are on or off', () => {
    const p = behavior({ type: 'boolean', label: 'Enabled', default: true });
    expect(p.parameter).toMatchObject({
      type: 'boolean',
      default: true,
      label: 'Enabled',
    });
    expect([0, 0.49, 0.5, 1].map(p.toValue)).toEqual([0, 0, 1, 1]);
    expect([p.format(1), p.format(0)]).toEqual(['On', 'Off']);
    expect(
      ['on', 'TRUE', 'yes', '1', 'off', 'False', 'no', '0', 'maybe'].map(
        p.parse,
      ),
    ).toEqual([1, 1, 1, 1, 0, 0, 0, 0, null]);
    expect(
      issues({ type: 'boolean', default: true, step: 1 })[0]?.message,
    ).toContain('boolean parameters have no step');
    expect(issues({ type: 'boolean', default: 1 })[0]?.message).toBe(
      'expected a boolean default',
    );
  });
});

describe('declarations', () => {
  it('keep their order and default label and access', () => {
    const resolved = resolve({
      ...even,
      bypass: { type: 'boolean', default: false },
    });
    expect(resolved.map((p) => [p.id, p.label, p.access])).toEqual([
      ['frequency', 'Frequency', 'automatable'],
      ['q', 'Q', 'automatable'],
      ['gain', 'Gain', 'automatable'],
      ['bypass', 'bypass', 'automatable'],
    ]);
  });

  it('carry access modes', () => {
    expect(
      parameter({
        type: 'float32',
        min: -60,
        max: 0,
        default: 0,
        access: 'readOnly',
      }).access,
    ).toBe('readOnly');
    expect(
      parameter({
        type: 'choice',
        access: 'manual',
        options: [{ value: 'off', label: 'Off' }],
        default: 'off',
      }).access,
    ).toBe('manual');
    expect(
      issues({ type: 'boolean', default: true, access: 'hidden' })[0],
    ).toEqual({
      path: 'parameters.p.access',
      message: "access is one of 'automatable', 'manual', 'readOnly'",
    });
  });

  it('are JSON: runtimes and test workers receive them as data', () => {
    const resolved = resolve(even);
    expect(JSON.parse(JSON.stringify(resolved))).toEqual(resolved);
  });

  it('explain types hosts cannot carry and renamed ones', () => {
    for (const [type, message] of [
      [
        'float64',
        "a 'float64' parameter is not supported: hosts carry parameter values as 32-bit floats",
      ],
      ['int64', "an 'int64' parameter is not supported"],
      ['uint64', "a 'uint64' parameter is not supported"],
      ['float', "'float' is now 'float32'"],
      ['enum', "'enum' is now 'choice'"],
      ['ratio', "unknown parameter type 'ratio'"],
    ])
      expect(
        issues({ type, min: 0, max: 1, default: 0 })[0]?.message,
      ).toContain(message);
  });

  it('keep integers exact through hosts', () => {
    expect(
      parameter({ type: 'int32', min: -(2 ** 23), max: 0, default: 0 }).type,
    ).toBe('int32');
    expect(
      issues({ type: 'int32', min: 0, max: 2 ** 24 + 1, default: 0 })[0]
        ?.message,
    ).toContain('beyond ±16777216 (2^24)');
    expect(
      issues({ type: 'uint32', min: 0, max: 2 ** 24, default: 0 })[0]?.message,
    ).toContain('more than 8388608 (2^23)');
    expect(
      issues({ type: 'int8', min: 0, max: 200, default: 0 })[0]?.message,
    ).toBe("max (200) is outside 'int8' (-128 to 127)");
    expect(
      issues({ type: 'int8', min: 0, max: 10, default: 1.5 })[0]?.message,
    ).toContain('must be an integer');
  });

  it('check ranges and defaults', () => {
    expect(
      issues({ type: 'float32', min: 1, max: 1, default: 1 })[0]?.message,
    ).toBe('min (1) must be below max (1)');
    expect(issues({ type: 'float32', min: 0, max: 1, default: 2 })[0]).toEqual({
      path: 'parameters.p.default',
      message: 'default (2) is out of range; set it within [0, 1]',
    });
    expect(
      issues({ type: 'float32', min: 'x', max: 1, default: 0 })[0],
    ).toEqual({
      path: 'parameters.p.min',
      message: 'expected a finite number for min',
    });
    expect(
      issues({ type: 'float32', min: 0, max: 1e39, default: 0 })[0]?.message,
    ).toContain('beyond the range of a float32');
  });

  it('report keys that are no identifiers, and the old array form', () => {
    expect(() =>
      resolve({ '1st': { type: 'boolean', default: true } }),
    ).toThrow(ConfigError);
    expect(() =>
      validateConfig({ plugin, runtimes: [], parameters: [] }),
    ).toThrow(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining('no longer an array'),
          }),
        ]),
      }),
    );
  });
});
