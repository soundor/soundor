/**
 * Build-time validation of an expression tree. TypeScript keeps the builder's
 * output well typed, but a tree can also come from JSON or be built by hand,
 * so compilers check every tree they are given: its shape, every node's type,
 * literals within their type, inputs and variables that exist.
 */

import { BINARY_OPERATORS, UNARY_OPERATORS, type ExpressionNode } from './ast';
import {
  INTEGERS,
  baseType,
  isBigIntType,
  isExpressionType,
  isFloatType,
  isIntegerType,
  isNullableType,
  isNumericType,
  type ExpressionType,
} from './types';

/** A problem in a tree, at a path such as `left.operand`. */
export interface ExpressionIssue {
  readonly path: string;
  readonly message: string;
}

/** Thrown by compilers for a tree that fails {@link checkExpression}. */
export class ExpressionError extends Error {
  readonly issues: readonly ExpressionIssue[];

  constructor(message: string, issues: readonly ExpressionIssue[]) {
    super(
      `${message}\n${issues.map((issue) => `  ${issue.path || '(root)'}: ${issue.message}`).join('\n')}`,
    );
    this.name = 'ExpressionError';
    this.issues = issues;
  }
}

/** The inputs an expression is evaluated with, by name. */
export type ExpressionInputs = Readonly<Record<string, ExpressionType>>;

export interface CheckOptions {
  /** The type the expression must have. */
  readonly expected?: ExpressionType;
}

/** The deepest tree accepted; compilers recurse. */
export const MAX_DEPTH = 128;
/** The most nodes in one tree. */
export const MAX_NODES = 10_000;
/** The most decimals `fixed` writes. */
export const MAX_FIXED_DIGITS = 15;

/** Every problem in `node`, evaluated with `inputs`; empty when it is valid. */
export function checkExpression(
  node: unknown,
  inputs: ExpressionInputs,
  options: CheckOptions = {},
): ExpressionIssue[] {
  const issues: ExpressionIssue[] = [];
  const state = { nodes: 0 };
  const type = visit(node, '', 0, inputs, new Map(), issues, state);
  if (
    type !== undefined &&
    options.expected !== undefined &&
    type !== options.expected
  ) {
    issues.push({
      path: '',
      message: `expected an expression of type '${options.expected}', got '${type}'`,
    });
  }
  return issues;
}

/** Throws {@link ExpressionError} when `node` is not valid. */
export function assertExpression(
  node: unknown,
  inputs: ExpressionInputs,
  options: CheckOptions = {},
): asserts node is ExpressionNode {
  const issues = checkExpression(node, inputs, options);
  if (issues.length > 0)
    throw new ExpressionError('Invalid expression.', issues);
}

const join = (path: string, key: string): string =>
  path === '' ? key : `${path}.${key}`;

function visit(
  value: unknown,
  path: string,
  depth: number,
  inputs: ExpressionInputs,
  scope: Map<string, ExpressionType>,
  issues: ExpressionIssue[],
  state: { nodes: number },
): ExpressionType | undefined {
  const fail = (message: string, at = path): undefined => {
    issues.push({ path: at, message });
    return undefined;
  };
  if (++state.nodes > MAX_NODES) {
    if (state.nodes === MAX_NODES + 1)
      return fail(`an expression has at most ${MAX_NODES} nodes`);
    return undefined;
  }
  if (depth > MAX_DEPTH)
    return fail(`an expression nests at most ${MAX_DEPTH} levels deep`);
  if (typeof value !== 'object' || value === null)
    return fail('expected an expression node');
  const node = value as Record<string, unknown> & { kind?: unknown };
  const type = node['type'];
  if (!isExpressionType(type))
    return fail(`unknown expression type ${JSON.stringify(type)}`);
  const child = (key: string): ExpressionType | undefined =>
    visit(node[key], join(path, key), depth + 1, inputs, scope, issues, state);
  const expect = (actual: ExpressionType, message: string) => {
    if (actual !== type)
      fail(`${message}: the node says '${type}', its value is '${actual}'`);
  };

  switch (node.kind) {
    case 'literal':
      return checkLiteral(type, node['value'], path, issues);
    case 'input':
    case 'variable': {
      const name = node['name'];
      if (typeof name !== 'string') return fail('expected a name');
      const declared = node.kind === 'input' ? inputs[name] : scope.get(name);
      if (declared === undefined) {
        return fail(
          node.kind === 'input'
            ? `unknown input '${name}'; this expression has ${
                Object.keys(inputs).length === 0
                  ? 'no inputs'
                  : Object.keys(inputs)
                      .map((input) => `'${input}'`)
                      .join(', ')
              }`
            : `variable '${name}' is not bound by an enclosing let or map`,
        );
      }
      if (declared !== type)
        return fail(`'${name}' is '${declared}', not '${type}'`);
      return type;
    }
    case 'unary': {
      const operator = node['operator'];
      if (!(UNARY_OPERATORS as readonly unknown[]).includes(operator))
        return fail(`unknown unary operator ${JSON.stringify(operator)}`);
      const operand = child('operand');
      if (operand === undefined) return undefined;
      let result: ExpressionType | undefined;
      switch (operator) {
        case 'neg':
        case 'abs':
          if (isNumericType(operand)) result = operand;
          break;
        case 'sqrt':
        case 'exp':
        case 'log':
        case 'floor':
        case 'ceil':
        case 'round':
          if (isFloatType(operand)) result = operand;
          break;
        case 'not':
          if (operand === 'boolean') result = operand;
          break;
        case 'trim':
        case 'lower':
          if (operand === 'string') result = operand;
          break;
      }
      if (result === undefined)
        return fail(`'${String(operator)}' does not take a '${operand}'`);
      expect(result, `'${String(operator)}'`);
      return type;
    }
    case 'binary': {
      const operator = node['operator'];
      if (!(BINARY_OPERATORS as readonly unknown[]).includes(operator))
        return fail(`unknown binary operator ${JSON.stringify(operator)}`);
      const left = child('left');
      const right = child('right');
      if (left === undefined || right === undefined) return undefined;
      if (left !== right)
        return fail(
          `'${String(operator)}' takes two operands of one type, got '${left}' and '${right}'; convert one explicitly`,
        );
      let result: ExpressionType | undefined;
      switch (operator) {
        case 'add':
        case 'sub':
        case 'mul':
        case 'div':
        case 'min':
        case 'max':
          if (isNumericType(left)) result = left;
          break;
        case 'pow':
          if (isFloatType(left)) result = left;
          break;
        case 'eq':
        case 'ne':
          if (!isNullableType(left)) result = 'boolean';
          break;
        case 'lt':
        case 'lte':
        case 'gt':
        case 'gte':
          if (isNumericType(left)) result = 'boolean';
          break;
        case 'and':
        case 'or':
          if (left === 'boolean') result = 'boolean';
          break;
        case 'endsWith':
          if (left === 'string') result = 'boolean';
          break;
        case 'removeSuffix':
          if (left === 'string') result = 'string';
          break;
      }
      if (result === undefined)
        return fail(`'${String(operator)}' does not take '${left}' operands`);
      expect(result, `'${String(operator)}'`);
      return type;
    }
    case 'if': {
      const condition = child('condition');
      const then = child('then');
      const otherwise = child('else');
      if (
        condition === undefined ||
        then === undefined ||
        otherwise === undefined
      )
        return undefined;
      if (condition !== 'boolean')
        return fail(
          `a condition is 'boolean', got '${condition}'`,
          join(path, 'condition'),
        );
      const joined = joinTypes(then, otherwise);
      if (joined === undefined)
        return fail(
          `the branches have different types, '${then}' and '${otherwise}'`,
        );
      expect(joined, 'if');
      return type;
    }
    case 'convert': {
      const operand = child('operand');
      if (operand === undefined) return undefined;
      if (!isNumericType(operand) || !isNumericType(type))
        return fail(
          `convert turns a number into another number, not '${operand}' into '${type}'`,
        );
      return type;
    }
    case 'fixed': {
      const operand = child('operand');
      if (operand === undefined) return undefined;
      const digits = node['digits'];
      if (
        typeof digits !== 'number' ||
        !Number.isInteger(digits) ||
        digits < 0 ||
        digits > MAX_FIXED_DIGITS
      )
        return fail(
          `fixed writes 0 to ${MAX_FIXED_DIGITS} decimals, got ${JSON.stringify(digits)}`,
          join(path, 'digits'),
        );
      if (!isNumericType(operand))
        return fail(`fixed formats a number, not a '${operand}'`);
      expect('string', 'fixed');
      return type;
    }
    case 'concat': {
      const operands = node['operands'];
      if (!Array.isArray(operands) || operands.length === 0)
        return fail('concat takes at least one string');
      let ok = true;
      operands.forEach((operand, index) => {
        const at = join(path, `operands[${index}]`);
        const operandType = visit(
          operand,
          at,
          depth + 1,
          inputs,
          scope,
          issues,
          state,
        );
        if (operandType === undefined) ok = false;
        else if (operandType !== 'string') {
          ok = false;
          fail(
            `concat takes strings, got '${operandType}'; format numbers with fixed`,
            at,
          );
        }
      });
      if (!ok) return undefined;
      expect('string', 'concat');
      return type;
    }
    case 'parse': {
      const operand = child('operand');
      if (operand === undefined) return undefined;
      if (operand !== 'string')
        return fail(`parse reads a string, not a '${operand}'`);
      if (!isNullableType(type))
        return fail(`parse gives a nullable number, not '${type}'`);
      return type;
    }
    case 'coalesce': {
      const operand = child('operand');
      const fallback = child('fallback');
      if (operand === undefined || fallback === undefined) return undefined;
      if (!isNullableType(operand))
        return fail(`coalesce takes a nullable value, not a '${operand}'`);
      if (fallback !== baseType(operand))
        return fail(
          `the fallback of a '${operand}' is a '${baseType(operand)}', not a '${fallback}'`,
        );
      expect(fallback, 'coalesce');
      return type;
    }
    case 'isNull': {
      const operand = child('operand');
      if (operand === undefined) return undefined;
      if (!isNullableType(operand))
        return fail(`isNull takes a nullable value, not a '${operand}'`);
      expect('boolean', 'isNull');
      return type;
    }
    case 'map': {
      const operand = child('operand');
      if (operand === undefined) return undefined;
      const variable = node['variable'];
      if (typeof variable !== 'string' || variable === '')
        return fail('a map names its variable', join(path, 'variable'));
      if (scope.has(variable))
        return fail(
          `variable '${variable}' is already bound`,
          join(path, 'variable'),
        );
      if (!isNullableType(operand))
        return fail(`map takes a nullable value, not a '${operand}'`);
      const inner = new Map(scope).set(variable, baseType(operand));
      const body = visit(
        node['body'],
        join(path, 'body'),
        depth + 1,
        inputs,
        inner,
        issues,
        state,
      );
      if (body === undefined) return undefined;
      if (!isNumericType(body) && !isNullableType(body))
        return fail(
          `a map gives a number, not a '${body}'`,
          join(path, 'body'),
        );
      expect(isNullableType(body) ? body : `${body}?`, 'map');
      return type;
    }
    case 'let': {
      const value = child('value');
      if (value === undefined) return undefined;
      const variable = node['variable'];
      if (typeof variable !== 'string' || variable === '')
        return fail('a let names its variable', join(path, 'variable'));
      if (scope.has(variable))
        return fail(
          `variable '${variable}' is already bound`,
          join(path, 'variable'),
        );
      const inner = new Map(scope).set(variable, value);
      const body = visit(
        node['body'],
        join(path, 'body'),
        depth + 1,
        inputs,
        inner,
        issues,
        state,
      );
      if (body === undefined) return undefined;
      expect(body, 'let');
      return type;
    }
    default:
      return fail(`unknown expression kind ${JSON.stringify(node.kind)}`);
  }
}

/** The type of `if (c) a else b`: equal types, or a number and its nullable. */
export function joinTypes(
  a: ExpressionType,
  b: ExpressionType,
): ExpressionType | undefined {
  if (a === b) return a;
  if (baseType(a) === baseType(b) && isNumericType(baseType(a)))
    return `${baseType(a)}?` as ExpressionType;
  return undefined;
}

function checkLiteral(
  type: ExpressionType,
  value: unknown,
  path: string,
  issues: ExpressionIssue[],
): ExpressionType | undefined {
  const problem = literalProblem(type, value);
  if (problem !== undefined) {
    issues.push({ path, message: problem });
    return undefined;
  }
  return type;
}

/** Why `value` is not a literal of `type`, or undefined when it is. */
export function literalProblem(
  type: ExpressionType,
  value: unknown,
): string | undefined {
  if (isNullableType(type)) {
    return value === null ? undefined : literalProblem(baseType(type), value);
  }
  if (type === 'boolean')
    return typeof value === 'boolean'
      ? undefined
      : `expected a boolean, got ${describe(value)}`;
  if (type === 'string')
    return typeof value === 'string'
      ? undefined
      : `expected a string, got ${describe(value)}`;
  if (isFloatType(type)) {
    if (typeof value !== 'number' || !Number.isFinite(value))
      return `a '${type}' literal is a finite number, got ${describe(value)}`;
    return undefined;
  }
  if (isIntegerType(type)) {
    const { min, max } = INTEGERS[type];
    let integer: bigint;
    if (isBigIntType(type)) {
      if (typeof value !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(value))
        return `a '${type}' literal is a decimal string, got ${describe(value)}`;
      integer = BigInt(value);
    } else {
      if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        Object.is(value, -0)
      )
        return `a '${type}' literal is an integer, got ${describe(value)}`;
      integer = BigInt(value);
    }
    if (integer < min || integer > max)
      return `${String(integer)} is outside '${type}' (${min} to ${max})`;
    return undefined;
  }
  return `no literal of type '${type}'`;
}

function describe(value: unknown): string {
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'number' && Object.is(value, -0)) return '-0';
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}
