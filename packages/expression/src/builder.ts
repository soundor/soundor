/**
 * The typed builder: how expressions are written. Every function returns a
 * frozen {@link Expression} whose type TypeScript knows, so an `int32` cannot
 * be added to a `float32`, a parser of an `int32` cannot return a `float32?`,
 * and a mistake shows in the editor rather than at build time. The trees are
 * still checked when they are compiled (`checkExpression`).
 *
 * Operands of one operation have one type; numbers convert explicitly
 * (`convert`). Where one operand is an expression, the other may be a plain
 * literal (`e.mul(e.value, 1000)`), which takes the expression's type.
 */

import type {
  BinaryOperator,
  Expression,
  ExpressionNode,
  UnaryOperator,
} from './ast';
import { isExpression } from './ast';
import { joinTypes, literalProblem } from './check';
import {
  baseType,
  isBigIntType,
  isNullableType,
  isNumericType,
  type BaseType,
  type BigIntType,
  type ExpressionType,
  type FloatType,
  type LiteralValue,
  type NullableType,
  type NumericType,
  type ScalarType,
} from './types';

/** A literal of a numeric type: a number, or a bigint for 64-bit integers. */
export type NumericLiteral<T extends NumericType> = T extends BigIntType
  ? bigint
  : number;

/** An operand of type `T`: an expression, or a literal of it. */
export type Operand<T extends NumericType> = Expression<T> | NumericLiteral<T>;

/** A string operand: an expression or a plain string. */
export type Text = Expression<'string'> | string;

/** The type `map` gives: the body's type, nullable. */
export type MapResult<U extends NumericType | NullableType> =
  `${BaseType<U> & NumericType}?`;

/** The types a branch may have when the other is an `A`: `A`, or a number and its nullable. */
export type IfBranch<A extends ExpressionType> =
  | A
  | (BaseType<A> extends NumericType ? BaseType<A> | `${BaseType<A>}?` : never);

/** The type `if` gives for two branch types. */
export type IfResult<A extends ExpressionType, B extends ExpressionType> = [
  A,
] extends [B]
  ? A
  : BaseType<A> extends BaseType<B>
    ? BaseType<B> extends BaseType<A>
      ? `${BaseType<A> & NumericType}?`
      : never
    : never;

/** Functions that build expressions. */
export interface ExpressionBuilder {
  // ── Literals ──
  int8(value: number): Expression<'int8'>;
  uint8(value: number): Expression<'uint8'>;
  int16(value: number): Expression<'int16'>;
  uint16(value: number): Expression<'uint16'>;
  int32(value: number): Expression<'int32'>;
  uint32(value: number): Expression<'uint32'>;
  int64(value: bigint): Expression<'int64'>;
  uint64(value: bigint): Expression<'uint64'>;
  float32(value: number): Expression<'float32'>;
  float64(value: number): Expression<'float64'>;
  boolean(value: boolean): Expression<'boolean'>;
  string(value: string): Expression<'string'>;
  /** A literal of any scalar type. */
  literal<T extends ScalarType>(type: T, value: LiteralValue<T>): Expression<T>;
  /** `null`, of a nullable number type. */
  null<T extends NumericType>(type: T): Expression<`${T}?`>;

  // ── Arithmetic ──
  /** `a + b`. Integers wrap around (two's complement); floats round to their type. */
  add<T extends NumericType>(
    a: Expression<T>,
    b: NoInfer<Operand<T>>,
  ): Expression<T>;
  add<T extends NumericType>(
    a: NumericLiteral<NoInfer<T>>,
    b: Expression<T>,
  ): Expression<T>;
  sub<T extends NumericType>(
    a: Expression<T>,
    b: NoInfer<Operand<T>>,
  ): Expression<T>;
  sub<T extends NumericType>(
    a: NumericLiteral<NoInfer<T>>,
    b: Expression<T>,
  ): Expression<T>;
  mul<T extends NumericType>(
    a: Expression<T>,
    b: NoInfer<Operand<T>>,
  ): Expression<T>;
  mul<T extends NumericType>(
    a: NumericLiteral<NoInfer<T>>,
    b: Expression<T>,
  ): Expression<T>;
  /** `a / b`. Integers truncate toward zero, and an integer divided by zero is 0. */
  div<T extends NumericType>(
    a: Expression<T>,
    b: NoInfer<Operand<T>>,
  ): Expression<T>;
  div<T extends NumericType>(
    a: NumericLiteral<NoInfer<T>>,
    b: Expression<T>,
  ): Expression<T>;
  /** The smaller; NaN if either is NaN, and -0 is less than +0. */
  min<T extends NumericType>(
    a: Expression<T>,
    b: NoInfer<Operand<T>>,
  ): Expression<T>;
  min<T extends NumericType>(
    a: NumericLiteral<NoInfer<T>>,
    b: Expression<T>,
  ): Expression<T>;
  max<T extends NumericType>(
    a: Expression<T>,
    b: NoInfer<Operand<T>>,
  ): Expression<T>;
  max<T extends NumericType>(
    a: NumericLiteral<NoInfer<T>>,
    b: Expression<T>,
  ): Expression<T>;
  /** `a` to the power `b`. */
  pow<T extends FloatType>(
    a: Expression<T>,
    b: NoInfer<Operand<T>>,
  ): Expression<T>;
  pow<T extends FloatType>(
    a: NumericLiteral<NoInfer<T>>,
    b: Expression<T>,
  ): Expression<T>;
  neg<T extends NumericType>(a: Expression<T>): Expression<T>;
  abs<T extends NumericType>(a: Expression<T>): Expression<T>;
  sqrt<T extends FloatType>(a: Expression<T>): Expression<T>;
  /** e to the power `a`. */
  exp<T extends FloatType>(a: Expression<T>): Expression<T>;
  /** The natural logarithm. */
  log<T extends FloatType>(a: Expression<T>): Expression<T>;
  floor<T extends FloatType>(a: Expression<T>): Expression<T>;
  ceil<T extends FloatType>(a: Expression<T>): Expression<T>;
  /** To the nearest integer; halves away from zero (2.5 → 3, -2.5 → -3). */
  round<T extends FloatType>(a: Expression<T>): Expression<T>;
  /**
   * The number as another numeric type. To an integer: truncated toward
   * zero, saturated at the type's bounds, NaN → 0. Between integers: wrapped
   * (two's complement). To a float: the nearest value.
   */
  convert<T extends NumericType>(
    a: Expression<NumericType>,
    type: T,
  ): Expression<T>;

  // ── Comparison and logic ──
  eq<T extends ScalarType>(
    a: Expression<T>,
    b: NoInfer<Expression<T> | LiteralValue<T>>,
  ): Expression<'boolean'>;
  ne<T extends ScalarType>(
    a: Expression<T>,
    b: NoInfer<Expression<T> | LiteralValue<T>>,
  ): Expression<'boolean'>;
  lt<T extends NumericType>(
    a: Expression<T>,
    b: NoInfer<Operand<T>>,
  ): Expression<'boolean'>;
  lt<T extends NumericType>(
    a: NumericLiteral<NoInfer<T>>,
    b: Expression<T>,
  ): Expression<'boolean'>;
  lte<T extends NumericType>(
    a: Expression<T>,
    b: NoInfer<Operand<T>>,
  ): Expression<'boolean'>;
  lte<T extends NumericType>(
    a: NumericLiteral<NoInfer<T>>,
    b: Expression<T>,
  ): Expression<'boolean'>;
  gt<T extends NumericType>(
    a: Expression<T>,
    b: NoInfer<Operand<T>>,
  ): Expression<'boolean'>;
  gt<T extends NumericType>(
    a: NumericLiteral<NoInfer<T>>,
    b: Expression<T>,
  ): Expression<'boolean'>;
  gte<T extends NumericType>(
    a: Expression<T>,
    b: NoInfer<Operand<T>>,
  ): Expression<'boolean'>;
  gte<T extends NumericType>(
    a: NumericLiteral<NoInfer<T>>,
    b: Expression<T>,
  ): Expression<'boolean'>;
  and(
    ...operands: [Expression<'boolean'>, ...Expression<'boolean'>[]]
  ): Expression<'boolean'>;
  or(
    ...operands: [Expression<'boolean'>, ...Expression<'boolean'>[]]
  ): Expression<'boolean'>;
  not(a: Expression<'boolean'>): Expression<'boolean'>;
  /** `then` when `condition` holds, else `otherwise`. A number and its nullable join into the nullable. */
  if(
    condition: Expression<'boolean'>,
    then: Text,
    otherwise: Text,
  ): Expression<'string'>;
  if<A extends ExpressionType, B extends IfBranch<A>>(
    condition: Expression<'boolean'>,
    then: Expression<A>,
    otherwise: Expression<B>,
  ): Expression<IfResult<A, B>>;

  // ── Text ──
  /**
   * `a` in decimal with exactly `digits` decimals (0 to 15), rounded half
   * away from zero; never a negative zero ("-0.00" is "0.00").
   */
  fixed(a: Expression<NumericType>, digits: number): Expression<'string'>;
  concat(...parts: [Text, ...Text[]]): Expression<'string'>;
  /** Without leading and trailing ASCII whitespace. */
  trim(a: Text): Expression<'string'>;
  /** With ASCII letters in lower case. */
  lower(a: Text): Expression<'string'>;
  endsWith(a: Text, suffix: Text): Expression<'boolean'>;
  /** `a` without `suffix` when it ends with it; `a` otherwise. */
  removeSuffix(a: Text, suffix: Text): Expression<'string'>;
  /**
   * Text as a number of `type`, or null when it is not one: decimal
   * notation (`-12`, `0.5`, `1e3`; integers without a fraction or exponent),
   * surrounding ASCII whitespace ignored. An integer outside its type, or a
   * float outside its finite range, is null.
   */
  parse<T extends NumericType>(text: Text, type: T): Expression<`${T}?`>;
  parseInt8(text: Text): Expression<'int8?'>;
  parseUint8(text: Text): Expression<'uint8?'>;
  parseInt16(text: Text): Expression<'int16?'>;
  parseUint16(text: Text): Expression<'uint16?'>;
  parseInt32(text: Text): Expression<'int32?'>;
  parseUint32(text: Text): Expression<'uint32?'>;
  parseInt64(text: Text): Expression<'int64?'>;
  parseUint64(text: Text): Expression<'uint64?'>;
  parseFloat32(text: Text): Expression<'float32?'>;
  parseFloat64(text: Text): Expression<'float64?'>;

  // ── Nullable values ──
  isNull(a: Expression<NullableType>): Expression<'boolean'>;
  /** The value of `a`, or `fallback` when it is null. */
  coalesce<T extends NumericType>(
    a: Expression<`${T}?`>,
    fallback: NoInfer<Operand<T>>,
  ): Expression<T>;
  /** `body` of `value`, computed once however often the body uses it. */
  let<T extends ExpressionType, U extends ExpressionType>(
    value: Expression<T>,
    body: (value: Expression<T>) => Expression<U>,
  ): Expression<U>;
  /** null when `a` is null; otherwise `body` of its value. */
  map<T extends NumericType, U extends NumericType | NullableType>(
    a: Expression<`${T}?`>,
    body: (value: Expression<T>) => Expression<U>,
  ): Expression<MapResult<U>>;
}

/** A builder with a context's inputs: `e.value`, `e.text`. */
export type ExpressionContext<
  I extends Readonly<Record<string, ExpressionType>>,
> = ExpressionBuilder & { readonly [K in keyof I]: Expression<I[K]> };

function freeze<T extends ExpressionNode>(node: T): Expression<T['type']> {
  return Object.freeze(node) as unknown as Expression<T['type']>;
}

function literal<T extends ExpressionType>(
  type: T,
  value: unknown,
): Expression<T> {
  let stored = value;
  if (isBigIntType(baseType(type)) && typeof value === 'bigint')
    stored = String(value);
  if (typeof stored === 'number' && Object.is(stored, -0)) stored = 0;
  const problem = literalProblem(type, stored);
  if (problem !== undefined) throw new TypeError(`Invalid literal: ${problem}`);
  return freeze({
    kind: 'literal',
    type,
    value: stored as never,
  }) as Expression<T>;
}

function text(value: Text): Expression<'string'> {
  if (typeof value === 'string') return literal('string', value);
  requireExpression(value, 'string');
  return value;
}

function requireExpression(
  value: unknown,
  what: string,
): asserts value is Expression {
  if (!isExpression(value))
    throw new TypeError(
      `Expected an expression (${what}), got ${String(value)}`,
    );
}

/** Two operands, one possibly a literal that takes the other's type. */
function operands(
  name: string,
  a: unknown,
  b: unknown,
): [Expression, Expression] {
  if (isExpression(a) && isExpression(b)) {
    if (a.type !== b.type)
      throw new TypeError(
        `${name}() takes operands of one type, got '${a.type}' and '${b.type}'; convert one explicitly`,
      );
    return [a, b];
  }
  if (isExpression(a)) return [a, literal(a.type, b)];
  if (isExpression(b)) return [literal(b.type, a), b];
  throw new TypeError(`${name}() needs at least one expression operand`);
}

function unary(
  operator: UnaryOperator,
  a: unknown,
  type?: ExpressionType,
): Expression {
  requireExpression(a, operator);
  return freeze({ kind: 'unary', type: type ?? a.type, operator, operand: a });
}

function binary(
  operator: BinaryOperator,
  a: unknown,
  b: unknown,
  result?: ExpressionType,
): Expression {
  const [left, right] = operands(operator, a, b);
  return freeze({
    kind: 'binary',
    type: result ?? left.type,
    operator,
    left,
    right,
  });
}

function chain(
  operator: 'and' | 'or',
  operands: readonly Expression<'boolean'>[],
): Expression<'boolean'> {
  if (operands.length === 0)
    throw new TypeError(`${operator}() needs an operand`);
  return operands.reduce(
    (left, right) =>
      binary(operator, left, right, 'boolean') as Expression<'boolean'>,
  );
}

function parse(textValue: Text, type: NumericType): Expression {
  if (!isNumericType(type))
    throw new TypeError(`parse() reads a numeric type, not '${String(type)}'`);
  return freeze({ kind: 'parse', type: `${type}?`, operand: text(textValue) });
}

/** How deep let and map bodies being built are: names their variables. */
let bindingDepth = 0;

function bind(
  type: ExpressionType,
  body: (value: Expression) => Expression,
): [string, Expression] {
  if (typeof body !== 'function')
    throw new TypeError('let() and map() take a function that builds the body');
  const variable = `v${bindingDepth}`;
  const value = freeze({ kind: 'variable', type, name: variable });
  bindingDepth++;
  let result: Expression;
  try {
    result = body(value);
  } finally {
    bindingDepth--;
  }
  requireExpression(result, 'body');
  return [variable, result];
}

const implementation = {
  int8: (value: number) => literal('int8', value),
  uint8: (value: number) => literal('uint8', value),
  int16: (value: number) => literal('int16', value),
  uint16: (value: number) => literal('uint16', value),
  int32: (value: number) => literal('int32', value),
  uint32: (value: number) => literal('uint32', value),
  int64: (value: bigint) => literal('int64', value),
  uint64: (value: bigint) => literal('uint64', value),
  float32: (value: number) => literal('float32', value),
  float64: (value: number) => literal('float64', value),
  boolean: (value: boolean) => literal('boolean', value),
  string: (value: string) => literal('string', value),
  literal: (type: ScalarType, value: unknown) => literal(type, value),
  null: (type: NumericType) => {
    if (!isNumericType(type))
      throw new TypeError(`null() takes a numeric type, not '${String(type)}'`);
    return literal(`${type}?`, null);
  },

  add: (a: unknown, b: unknown) => binary('add', a, b),
  sub: (a: unknown, b: unknown) => binary('sub', a, b),
  mul: (a: unknown, b: unknown) => binary('mul', a, b),
  div: (a: unknown, b: unknown) => binary('div', a, b),
  min: (a: unknown, b: unknown) => binary('min', a, b),
  max: (a: unknown, b: unknown) => binary('max', a, b),
  pow: (a: unknown, b: unknown) => binary('pow', a, b),
  neg: (a: unknown) => unary('neg', a),
  abs: (a: unknown) => unary('abs', a),
  sqrt: (a: unknown) => unary('sqrt', a),
  exp: (a: unknown) => unary('exp', a),
  log: (a: unknown) => unary('log', a),
  floor: (a: unknown) => unary('floor', a),
  ceil: (a: unknown) => unary('ceil', a),
  round: (a: unknown) => unary('round', a),
  convert: (a: unknown, type: NumericType) => {
    requireExpression(a, 'convert');
    if (!isNumericType(type))
      throw new TypeError(
        `convert() turns a number into a numeric type, not '${String(type)}'`,
      );
    return freeze({ kind: 'convert', type, operand: a });
  },

  eq: (a: unknown, b: unknown) => binary('eq', a, b, 'boolean'),
  ne: (a: unknown, b: unknown) => binary('ne', a, b, 'boolean'),
  lt: (a: unknown, b: unknown) => binary('lt', a, b, 'boolean'),
  lte: (a: unknown, b: unknown) => binary('lte', a, b, 'boolean'),
  gt: (a: unknown, b: unknown) => binary('gt', a, b, 'boolean'),
  gte: (a: unknown, b: unknown) => binary('gte', a, b, 'boolean'),
  and: (...operands: Expression<'boolean'>[]) => chain('and', operands),
  or: (...operands: Expression<'boolean'>[]) => chain('or', operands),
  not: (a: unknown) => unary('not', a, 'boolean'),
  if: (condition: unknown, then: unknown, otherwise: unknown) => {
    requireExpression(condition, 'if condition');
    const a = typeof then === 'string' ? literal('string', then) : then;
    const b =
      typeof otherwise === 'string' ? literal('string', otherwise) : otherwise;
    requireExpression(a, 'if branch');
    requireExpression(b, 'else branch');
    const type = joinTypes(a.type, b.type);
    if (type === undefined)
      throw new TypeError(
        `if() branches have different types, '${a.type}' and '${b.type}'`,
      );
    return freeze({ kind: 'if', type, condition, then: a, else: b });
  },

  fixed: (a: unknown, digits: number) => {
    requireExpression(a, 'fixed');
    return freeze({ kind: 'fixed', type: 'string', operand: a, digits });
  },
  concat: (...parts: Text[]) => {
    if (parts.length === 0) throw new TypeError('concat() needs a part');
    return freeze({
      kind: 'concat',
      type: 'string',
      operands: Object.freeze(parts.map(text)),
    });
  },
  trim: (a: Text) => unary('trim', text(a)),
  lower: (a: Text) => unary('lower', text(a)),
  endsWith: (a: Text, suffix: Text) =>
    binary('endsWith', text(a), text(suffix), 'boolean'),
  removeSuffix: (a: Text, suffix: Text) =>
    binary('removeSuffix', text(a), text(suffix), 'string'),
  parse: (value: Text, type: NumericType) => parse(value, type),
  parseInt8: (value: Text) => parse(value, 'int8'),
  parseUint8: (value: Text) => parse(value, 'uint8'),
  parseInt16: (value: Text) => parse(value, 'int16'),
  parseUint16: (value: Text) => parse(value, 'uint16'),
  parseInt32: (value: Text) => parse(value, 'int32'),
  parseUint32: (value: Text) => parse(value, 'uint32'),
  parseInt64: (value: Text) => parse(value, 'int64'),
  parseUint64: (value: Text) => parse(value, 'uint64'),
  parseFloat32: (value: Text) => parse(value, 'float32'),
  parseFloat64: (value: Text) => parse(value, 'float64'),

  isNull: (a: unknown) => {
    requireExpression(a, 'isNull');
    return freeze({ kind: 'isNull', type: 'boolean', operand: a });
  },
  coalesce: (a: unknown, fallback: unknown) => {
    requireExpression(a, 'coalesce');
    if (!isNullableType(a.type))
      throw new TypeError(
        `coalesce() takes a nullable value, not a '${a.type}'`,
      );
    const other = isExpression(fallback)
      ? fallback
      : literal(baseType(a.type), fallback);
    return freeze({
      kind: 'coalesce',
      type: baseType(a.type),
      operand: a,
      fallback: other,
    });
  },
  let: (value: unknown, body: (value: Expression) => Expression) => {
    requireExpression(value, 'let');
    const [variable, result] = bind(value.type, body);
    return freeze({
      kind: 'let',
      type: result.type,
      value,
      variable,
      body: result,
    });
  },
  map: (a: unknown, body: (value: Expression) => Expression) => {
    requireExpression(a, 'map');
    if (!isNullableType(a.type))
      throw new TypeError(`map() takes a nullable value, not a '${a.type}'`);
    const [variable, result] = bind(baseType(a.type), body);
    const type = isNullableType(result.type) ? result.type : `${result.type}?`;
    return freeze({
      kind: 'map',
      type: type as NullableType,
      operand: a,
      variable,
      body: result,
    });
  },
};

/** The builder, without inputs. */
export const expressions: ExpressionBuilder = Object.freeze(
  implementation,
) as unknown as ExpressionBuilder;

/** An input of an expression context, such as `value`. */
export function input<T extends ExpressionType>(
  name: string,
  type: T,
): Expression<T> {
  return freeze({ kind: 'input', type, name }) as Expression<T>;
}

/**
 * The builder with the context's inputs as properties: what a callback such
 * as `format: (e) => …` receives.
 */
export function createContext<
  const I extends Readonly<Record<string, ExpressionType>>,
>(inputs: I): ExpressionContext<I> {
  const context: Record<string, unknown> = { ...implementation };
  for (const [name, type] of Object.entries(inputs)) {
    if (name in implementation)
      throw new TypeError(`Input '${name}' would hide the builder's ${name}()`);
    context[name] = input(name, type);
  }
  return Object.freeze(context) as unknown as ExpressionContext<I>;
}
