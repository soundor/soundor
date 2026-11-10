import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Expression } from './ast';
import { createContext, expressions as e } from './builder';
import { checkExpression } from './check';
import { compileJsFunction } from './compiler/js';
import { substituteInputs } from './substitute';

describe('the builder', () => {
  it('types every expression', () => {
    const f = createContext({ value: 'float32', text: 'string' });
    expectTypeOf(f.value).toEqualTypeOf<Expression<'float32'>>();
    expectTypeOf(e.add(f.value, 1)).toEqualTypeOf<Expression<'float32'>>();
    expectTypeOf(e.mul(2, f.value)).toEqualTypeOf<Expression<'float32'>>();
    expectTypeOf(e.gte(f.value, 1000)).toEqualTypeOf<Expression<'boolean'>>();
    expectTypeOf(e.parseFloat32(f.text)).toEqualTypeOf<
      Expression<'float32?'>
    >();
    expectTypeOf(e.parse(f.text, 'int16')).toEqualTypeOf<
      Expression<'int16?'>
    >();
    expectTypeOf(e.convert(f.value, 'int32')).toEqualTypeOf<
      Expression<'int32'>
    >();
    expectTypeOf(e.fixed(f.value, 2)).toEqualTypeOf<Expression<'string'>>();
    expectTypeOf(e.coalesce(e.parseFloat32(f.text), 0)).toEqualTypeOf<
      Expression<'float32'>
    >();
    expectTypeOf(
      e.map(e.parseFloat32(f.text), (v) => e.mul(v, 1000)),
    ).toEqualTypeOf<Expression<'float32?'>>();
    expectTypeOf(
      e.if(e.boolean(true), f.value, e.null('float32')),
    ).toEqualTypeOf<Expression<'float32?'>>();
    expectTypeOf(e.if(e.boolean(true), 'a', e.concat('b'))).toEqualTypeOf<
      Expression<'string'>
    >();
    expectTypeOf(e.add(e.int64(1n), 2n)).toEqualTypeOf<Expression<'int64'>>();
  });

  it('keeps types apart that are all JavaScript numbers', () => {
    const f = createContext({ a: 'float32', i: 'int32' });
    const typeErrors = () => {
      // @ts-expect-error an int32 and a float32 do not add
      e.add(f.a, f.i);
      // @ts-expect-error a float64 is not a float32
      const wrong: Expression<'float32'> = e.float64(1);
      void wrong;
      // @ts-expect-error integers have no square root
      e.sqrt(f.i);
      // @ts-expect-error a nullable needs map or coalesce first
      e.add(e.parseFloat32('1'), 1);
      // @ts-expect-error 64-bit literals are bigints
      e.add(e.int64(1n), 2);
      // @ts-expect-error the branches disagree
      e.if(e.boolean(true), f.a, f.i);
    };
    void typeErrors;
    expect(() => e.add(f.a as never, f.i as never)).toThrow(
      "add() takes operands of one type, got 'float32' and 'int32'",
    );
  });

  it('checks literals', () => {
    expect(() => e.int8(128)).toThrow("128 is outside 'int8'");
    expect(() => e.uint32(-1)).toThrow("outside 'uint32'");
    expect(() => e.int32(1.5)).toThrow('is an integer');
    expect(() => e.float32(Infinity)).toThrow('finite number');
    expect(() => e.mul(e.int16(1), 1e6)).toThrow("outside 'int16'");
    expect(e.uint64(18446744073709551615n)).toMatchObject({
      value: '18446744073709551615',
    });
    expect(e.float64(-0)).toMatchObject({ value: 0 });
  });

  it('builds plain, frozen, serializable trees', () => {
    const f = createContext({ value: 'float32' });
    const tree = e.concat(e.fixed(e.div(f.value, 1000), 2), ' kHz');
    expect(Object.isFrozen(tree)).toBe(true);
    expect(JSON.parse(JSON.stringify(tree))).toEqual(tree);
    expect(
      checkExpression(
        JSON.parse(JSON.stringify(tree)),
        { value: 'float32' },
        { expected: 'string' },
      ),
    ).toEqual([]);
  });

  it('names map variables by depth', () => {
    const tree = e.map(e.parseInt32('1'), (x) =>
      e.map(e.parseInt32('2'), (y) => e.add(x, y)),
    );
    expect(tree).toMatchObject({ variable: 'v0', body: { variable: 'v1' } });
    expect(checkExpression(tree, {})).toEqual([]);
  });

  it('substitutes inputs without capturing variables', () => {
    const { value } = createContext({ value: 'float64' });
    const target = e.let(e.mul(value, 2), (v) => e.add(v, value));
    const outer = e.let(e.float64(5), (v) =>
      substituteInputs(target, { value: v }),
    );
    expect(checkExpression(outer, {})).toEqual([]);
    expect(compileJsFunction(outer, {})()).toBe(15);
    expect(() => substituteInputs(target, { value: e.float32(1) })).toThrow(
      "its replacement a 'float32'",
    );
  });

  it('refuses inputs that hide builder functions', () => {
    expect(() => createContext({ add: 'float32' })).toThrow(
      "would hide the builder's add()",
    );
  });
});

describe('checkExpression', () => {
  it('reports where a tree is wrong', () => {
    expect(
      checkExpression(
        {
          kind: 'concat',
          type: 'string',
          operands: [{ kind: 'input', type: 'float32', name: 'value' }],
        },
        { value: 'float32' },
      ),
    ).toEqual([
      {
        path: 'operands[0]',
        message:
          "concat takes strings, got 'float32'; format numbers with fixed",
      },
    ]);
    expect(
      checkExpression(
        { kind: 'input', type: 'float32', name: 'nope' },
        { value: 'float32' },
      ),
    ).toEqual([
      {
        path: '',
        message: "unknown input 'nope'; this expression has 'value'",
      },
    ]);
    expect(checkExpression(e.float32(1), {}, { expected: 'string' })).toEqual([
      {
        path: '',
        message: "expected an expression of type 'string', got 'float32'",
      },
    ]);
  });

  it('refuses what the language does not have', () => {
    expect(
      checkExpression({ kind: 'call', type: 'float32' }, {})[0]?.message,
    ).toBe('unknown expression kind "call"');
    expect(
      checkExpression(
        {
          kind: 'unary',
          type: 'float32',
          operator: 'sin',
          operand: e.float32(1),
        },
        {},
      )[0]?.message,
    ).toBe('unknown unary operator "sin"');
    expect(
      checkExpression({ kind: 'literal', type: 'float32', value: '1' }, {})[0]
        ?.message,
    ).toContain('finite number');
    expect(
      checkExpression({ kind: 'variable', type: 'float32', name: 'v0' }, {})[0]
        ?.message,
    ).toBe("variable 'v0' is not bound by an enclosing let or map");
    expect(
      checkExpression(e.fixed(e.float32(1), 16), {})[0]?.message,
    ).toContain('0 to 15 decimals');
  });

  it('limits depth', () => {
    let tree: Expression<'float64'> = e.float64(1);
    for (let i = 0; i < 200; i++) tree = e.neg(tree);
    expect(checkExpression(tree, {})[0]?.message).toContain(
      'nests at most 128 levels',
    );
  });
});
