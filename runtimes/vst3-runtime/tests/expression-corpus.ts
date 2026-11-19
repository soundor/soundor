/**
 * The expression corpus the adapter's interpreter is checked against
 * (native/tests/AdapterTests.cpp): @soundor/expression's own differential
 * corpus, every sample with the result its JavaScript compiler computes,
 * written as `native/tests/generated/expression-corpus.json` (checked in:
 * the native tests run without Node; src/expression-corpus.test.ts checks
 * it is current, and writes it with UPDATE_GOLDEN=1).
 * The interpreter must compute the same bits, as the C++ compiler's output
 * does.
 */

import { compileJsFunction } from '@soundor/runtime-sdk/expression/js';

// The workspace's corpus: a workspace-only file (the package never ships it).
import { corpus } from '../../../packages/expression/src/__tests__/corpus';

type Encoded = string | number | boolean | null;

function isFloat(type: string): boolean {
  return type.startsWith('float');
}

/** A value as JSON: floats by their bits (NaN and -0 survive), 64-bit integers as strings. */
function encode(type: string, value: unknown): Encoded {
  if (value === null) return null;
  const base = type.replace(/\?$/, '');
  if (base === 'boolean' || base === 'string') return value as boolean | string;
  if (typeof value === 'bigint') return value.toString();
  if (isFloat(base)) {
    const number = value as number;
    if (Number.isNaN(number)) return 'NaN';
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, number);
    return `0x${view.getBigUint64(0).toString(16).padStart(16, '0')}`;
  }
  return value as number;
}

export function renderExpressionCorpus(): string {
  const cases = corpus.map((test) => {
    const types = Object.values(test.inputs) as string[];
    const names = Object.keys(test.inputs);
    const fn = compileJsFunction(test.expression, test.inputs);
    return {
      name: test.name,
      inputs: names.map((name, index) => ({ name, type: types[index]! })),
      expression: test.expression,
      samples: test.samples.map(([values]) => {
        const held = values.map((value, index) =>
          types[index] === 'float32' ? Math.fround(value as number) : value,
        );
        return {
          values: held.map((value, index) => encode(types[index]!, value)),
          result: encode(test.expression.type, fn(...held)),
        };
      }),
    };
  });
  return `${JSON.stringify({ generatedBy: 'UPDATE_GOLDEN=1 vitest run src/expression-corpus.test.ts', cases }, null, 1)}\n`;
}
