/**
 * The parameters' generated C++, checked in as the JUCE adapter tests' input
 * (`native/backend/juce/tests/generated/`), with the parity table those tests
 * hold the C++ to: what the same expressions compute in JavaScript, as the
 * Web runtime runs them. Regenerate after a change meant to change them:
 *
 *   UPDATE_GOLDEN=1 pnpm --filter @soundor/juce-runtime test
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveConfig,
  semanticsInputs,
  type ResolvedParameter,
} from '@soundor/runtime-sdk';
import { cppStringLiteral } from '@soundor/runtime-sdk/expression/cpp';
import { compileJsFunction } from '@soundor/runtime-sdk/expression/js';
import { describe, expect, it } from 'vitest';

import { renderParametersSource } from './parameter-codegen';

const generated = join(
  dirname(fileURLToPath(import.meta.url)),
  '../native/backend/juce/tests/generated',
);

/** Every kind of parameter, Even's ranges among them. */
export const TEST_PARAMETERS = {
  frequency: {
    type: 'float32',
    label: 'Frequency',
    min: 20,
    max: 20000,
    default: 1000,
    mapping: 'log',
    unit: 'Hz',
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
  drive: {
    type: 'float32',
    label: 'Drive',
    min: 0,
    max: 1,
    default: 0.5,
    mapping: { type: 'symmetricPower', exponent: 2 },
  },
  voices: {
    type: 'int32',
    label: 'Voices',
    min: 1,
    max: 16,
    default: 4,
    access: 'manual',
  },
  octave: {
    type: 'int8',
    label: 'Octave',
    min: -4,
    max: 4,
    default: 0,
    step: 2,
  },
  bypass: { type: 'boolean', label: 'Bypass', default: false },
  filterType: {
    type: 'choice',
    label: 'Filter Type',
    options: [
      { value: 'bell', label: 'Bell' },
      { value: 'lowpass', label: 'Low Pass' },
      { value: 'highpass', label: 'High Pass' },
    ],
    default: 'bell',
  },
  reduction: {
    type: 'float32',
    label: 'Reduction',
    min: -60,
    max: 0,
    default: 0,
    unit: 'dB',
    access: 'readOnly',
  },
};

function resolved(): readonly ResolvedParameter[] {
  return resolveConfig({
    plugin: { id: 'dev.soundor.parameters', name: 'Parameters' },
    runtimes: [],
    parameters: TEST_PARAMETERS,
  }).parameters;
}

/** A double as a C++ hexadecimal floating literal: exact, whatever parses it. */
export function hexFloat(value: number): string {
  if (Object.is(value, -0)) return '-0x0p+0';
  if (value === 0) return '0x0p+0';
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const sign = bits >> 63n ? '-' : '';
  const exponent = Number((bits >> 52n) & 0x7ffn);
  const mantissa = (bits & ((1n << 52n) - 1n)).toString(16).padStart(13, '0');
  return exponent === 0
    ? `${sign}0x0.${mantissa}p-1022`
    : `${sign}0x1.${mantissa}p${exponent - 1023 >= 0 ? '+' : ''}${exponent - 1023}`;
}

/** What the parameters compute in JavaScript, for the C++ to equal. */
function renderParity(parameters: readonly ResolvedParameter[]): string {
  const numbers: string[] = [];
  const formats: string[] = [];
  const parses: string[] = [];
  for (const parameter of parameters) {
    const { semantics } = parameter;
    const inputs = semanticsInputs(semantics.valueType);
    const run = (expression: unknown, i: object) =>
      compileJsFunction(expression, i as never) as (x: unknown) => unknown;
    const toValue = run(semantics.toValue, inputs.toValue) as (
      t: number,
    ) => number;
    const toNormalized = run(semantics.toNormalized, inputs.toNormalized) as (
      v: number,
    ) => number;
    const constrain = run(semantics.constrain, inputs.constrain) as (
      v: number,
    ) => number;
    const format = run(semantics.format, inputs.format) as (
      v: number,
    ) => string;
    const parse = run(semantics.parse, inputs.parse) as (
      text: string,
    ) => number | null;
    const id = JSON.stringify(parameter.id);
    const positions = [
      -0.25,
      ...Array.from({ length: 33 }, (_, i) => i / 32),
      1 / 3,
      0.7071,
      1.5,
    ];
    const values = positions.map(toValue);
    for (const [i, t] of positions.entries())
      numbers.push(
        `        { ${id}, Kind::ToValue, ${hexFloat(t)}, ${hexFloat(values[i]!)} },`,
      );
    for (const value of values)
      numbers.push(
        `        { ${id}, Kind::ToNormalized, ${hexFloat(value)}, ${hexFloat(toNormalized(value))} },`,
      );
    const plain =
      parameter.type === 'boolean' || parameter.type === 'choice'
        ? { min: 0, max: 2 }
        : parameter;
    const raw = [
      plain.min - 1,
      plain.max + 1,
      ...positions.map((t) => plain.min + t * (plain.max - plain.min) + 0.0137),
    ];
    for (const value of raw)
      numbers.push(
        `        { ${id}, Kind::Constrain, ${hexFloat(value)}, ${hexFloat(constrain(value))} },`,
      );
    const texts = new Set<string>([
      '',
      '  ',
      'nonsense',
      '1e3',
      '-0',
      '30 dB',
      '0.5',
      'ON',
      'low pass',
      '20 khz',
      '999.5',
    ]);
    for (const value of values) {
      const text = format(value);
      formats.push(
        `        { ${id}, ${hexFloat(value)}, ${cppStringLiteral(text)} },`,
      );
      texts.add(text);
    }
    for (const text of texts) {
      const value = parse(text);
      parses.push(
        `        { ${id}, ${cppStringLiteral(text)}, ${value !== null}, ${hexFloat(value ?? 0)} },`,
      );
    }
  }
  return `// This file was generated by Soundor. Do not edit.
// What the test parameters compute in JavaScript (as the Web runtime runs
// them); the C++ generated from the same expressions must compute the same.

#pragma once

namespace parity
{
    enum class Kind
    {
        ToValue,
        ToNormalized,
        Constrain,
    };

    struct NumberProbe
    {
        const char* parameter;
        Kind kind;
        double input;
        double output;
    };

    struct FormatProbe
    {
        const char* parameter;
        double value;
        const char* text;
    };

    struct ParseProbe
    {
        const char* parameter;
        const char* text;
        bool ok;
        double value;
    };

    inline constexpr NumberProbe numbers[] {
${numbers.join('\n')}
    };

    inline constexpr FormatProbe formats[] {
${formats.join('\n')}
    };

    inline constexpr ParseProbe parses[] {
${parses.join('\n')}
    };
} // namespace parity
`;
}

function golden(name: string, contents: string): void {
  const path = join(generated, name);
  if (process.env['UPDATE_GOLDEN'] === '1') writeFileSync(path, contents);
  expect(
    readFileSync(path, 'utf8'),
    `${name} is stale: UPDATE_GOLDEN=1 pnpm --filter @soundor/juce-runtime test`,
  ).toBe(contents);
}

describe('the parameters C++', () => {
  it('is the golden the JUCE adapter tests compile', () => {
    expect.hasAssertions();
    golden(
      'TestParameters.cpp',
      renderParametersSource(
        resolved(),
        'soundor::inline SOUNDOR_ABI_NAMESPACE::generated',
      ),
    );
  });

  it('is held to what JavaScript computes', () => {
    expect.hasAssertions();
    golden('ParameterParity.h', renderParity(resolved()));
  });

  it('writes hexadecimal floats exactly', () => {
    expect(hexFloat(1)).toBe('0x1.0000000000000p+0');
    expect(hexFloat(-0.5)).toBe('-0x1.0000000000000p-1');
    expect(hexFloat(Math.fround(0.1))).toBe('0x1.99999a0000000p-4');
    expect(hexFloat(5e-324)).toBe('0x0.0000000000001p-1022');
  });

  it('declares every parameter, and none when there are none', () => {
    const none = renderParametersSource([], 'soundor::generated');
    expect(none).toContain('// no parameters');
    expect(none).toContain(
      'std::span<const backend::ParameterBehavior> parameterBehaviors()',
    );
  });
});
