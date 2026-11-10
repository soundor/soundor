/**
 * The expression AST: plain, immutable, JSON-serializable objects. Every node
 * carries its result type, so a tree means the same thing wherever it is read,
 * and {@link Expression} can tell a `float32` expression from an `int32` one.
 *
 * There are no loops, assignments, calls of user functions, or anything with
 * an effect: an expression is a pure function of its inputs. Two forms bind a
 * name, immutably: `let` names a value used more than once, and `map` the
 * value of a nullable that is not null.
 */

import type { ExpressionType, NullableType, NumericType } from './types';

/** Operators of one operand. */
export const UNARY_OPERATORS = [
  'neg',
  'abs',
  'sqrt',
  'exp',
  'log',
  'floor',
  'ceil',
  'round',
  'not',
  'trim',
  'lower',
] as const;

/** Operators of two operands. */
export const BINARY_OPERATORS = [
  'add',
  'sub',
  'mul',
  'div',
  'min',
  'max',
  'pow',
  'eq',
  'ne',
  'lt',
  'lte',
  'gt',
  'gte',
  'and',
  'or',
  'endsWith',
  'removeSuffix',
] as const;

export type UnaryOperator = (typeof UNARY_OPERATORS)[number];
export type BinaryOperator = (typeof BINARY_OPERATORS)[number];

/**
 * A literal. Numbers of up to 32 bits and floats are JSON numbers (finite);
 * 64-bit integers are decimal strings, so a tree survives JSON. `null` only
 * for a nullable type.
 */
export interface LiteralNode {
  readonly kind: 'literal';
  readonly type: ExpressionType;
  readonly value: number | string | boolean | null;
}

/** A value the expression is evaluated with, bound by its context. */
export interface InputNode {
  readonly kind: 'input';
  readonly type: ExpressionType;
  readonly name: string;
}

/** The value a `map` binds. */
export interface VariableNode {
  readonly kind: 'variable';
  readonly type: ExpressionType;
  readonly name: string;
}

export interface UnaryNode {
  readonly kind: 'unary';
  readonly type: ExpressionType;
  readonly operator: UnaryOperator;
  readonly operand: ExpressionNode;
}

export interface BinaryNode {
  readonly kind: 'binary';
  readonly type: ExpressionType;
  readonly operator: BinaryOperator;
  readonly left: ExpressionNode;
  readonly right: ExpressionNode;
}

export interface IfNode {
  readonly kind: 'if';
  readonly type: ExpressionType;
  readonly condition: ExpressionNode;
  readonly then: ExpressionNode;
  readonly else: ExpressionNode;
}

/** A numeric value as another numeric type. */
export interface ConvertNode {
  readonly kind: 'convert';
  readonly type: NumericType;
  readonly operand: ExpressionNode;
}

/** A number in decimal notation with a fixed number of decimals. */
export interface FixedNode {
  readonly kind: 'fixed';
  readonly type: 'string';
  readonly operand: ExpressionNode;
  readonly digits: number;
}

export interface ConcatNode {
  readonly kind: 'concat';
  readonly type: 'string';
  readonly operands: readonly ExpressionNode[];
}

/** Text read as a number of `type`'s base type, or `null`. */
export interface ParseNode {
  readonly kind: 'parse';
  readonly type: NullableType;
  readonly operand: ExpressionNode;
}

/** A nullable's value, or `fallback` when it is null. */
export interface CoalesceNode {
  readonly kind: 'coalesce';
  readonly type: ExpressionType;
  readonly operand: ExpressionNode;
  readonly fallback: ExpressionNode;
}

export interface IsNullNode {
  readonly kind: 'isNull';
  readonly type: 'boolean';
  readonly operand: ExpressionNode;
}

/**
 * `null` when `operand` is null; otherwise `body`, in which `variable` is
 * the operand's value.
 */
export interface MapNode {
  readonly kind: 'map';
  readonly type: NullableType;
  readonly operand: ExpressionNode;
  readonly variable: string;
  readonly body: ExpressionNode;
}

/** `body`, in which `variable` is the value of `value` (computed once). */
export interface LetNode {
  readonly kind: 'let';
  readonly type: ExpressionType;
  readonly value: ExpressionNode;
  readonly variable: string;
  readonly body: ExpressionNode;
}

export type ExpressionNode =
  | LiteralNode
  | InputNode
  | VariableNode
  | UnaryNode
  | BinaryNode
  | IfNode
  | ConvertNode
  | FixedNode
  | ConcatNode
  | ParseNode
  | CoalesceNode
  | IsNullNode
  | MapNode
  | LetNode;

/**
 * An expression whose value is of type `T`. Its `type` keeps expressions of
 * different types apart even where both are a JavaScript `number`.
 */
export type Expression<T extends ExpressionType = ExpressionType> =
  ExpressionNode & { readonly type: T };

export type ExpressionKind = ExpressionNode['kind'];

/** Whether `value` looks like an expression node (its shape is checked by `checkExpression`). */
export function isExpression(value: unknown): value is Expression {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === 'string' &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}
