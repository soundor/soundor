/**
 * Soundor's expression language: small, statically typed, deterministic and
 * portable. An expression is a JSON-serializable tree ({@link Expression}),
 * written with the typed builder and compiled to C++
 * (`@soundor/expression/compiler/cpp`) and JavaScript
 * (`@soundor/expression/compiler/js`) with the same semantics.
 */

export { BINARY_OPERATORS, UNARY_OPERATORS, isExpression } from './ast';
export type {
  BinaryNode,
  BinaryOperator,
  CoalesceNode,
  ConcatNode,
  ConvertNode,
  Expression,
  ExpressionKind,
  ExpressionNode,
  FixedNode,
  IfNode,
  InputNode,
  IsNullNode,
  LetNode,
  LiteralNode,
  MapNode,
  ParseNode,
  UnaryNode,
  UnaryOperator,
  VariableNode,
} from './ast';
export { createContext, expressions, input } from './builder';
export { substituteInputs } from './substitute';
export type {
  ExpressionBuilder,
  ExpressionContext,
  IfBranch,
  IfResult,
  MapResult,
  NumericLiteral,
  Operand,
  Text,
} from './builder';
export {
  ExpressionError,
  MAX_DEPTH,
  MAX_FIXED_DIGITS,
  MAX_NODES,
  assertExpression,
  checkExpression,
} from './check';
export type { CheckOptions, ExpressionInputs, ExpressionIssue } from './check';
export {
  FLOAT_TYPES,
  INTEGERS,
  INTEGER_TYPES,
  NUMERIC_TYPES,
  SCALAR_TYPES,
  baseType,
  isBigIntType,
  isExpressionType,
  isFloatType,
  isIntegerType,
  isNullableType,
  isNumericType,
} from './types';
export type {
  BaseType,
  BigIntType,
  ExpressionType,
  FloatType,
  IntegerInfo,
  IntegerType,
  JsValue,
  LiteralValue,
  NullableType,
  NumericType,
  ScalarType,
} from './types';
