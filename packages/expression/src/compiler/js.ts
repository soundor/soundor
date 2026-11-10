/**
 * Compiles expressions to JavaScript: a JavaScript expression per tree, over
 * a small runtime ({@link JS_RUNTIME}) that the code it emits calls. The
 * output depends on nothing else, so a generated module can carry it into a
 * browser, a worker or a test environment.
 *
 * The semantics are the language's, shared with the C++ compiler: numbers of
 * up to 32 bits and floats are JavaScript numbers, 64-bit integers bigints,
 * `null` a nullable's absence. `float32` arithmetic is rounded to binary32
 * after every operation (`Math.fround`), integers wrap.
 */

import type { ExpressionNode } from '../ast';
import { assertExpression, type ExpressionInputs } from '../check';
import {
  INTEGERS,
  baseType,
  isBigIntType,
  isFloatType,
  isIntegerType,
  type ExpressionType,
  type IntegerType,
  type NumericType,
} from '../types';

/** The name the emitted code calls the runtime by. */
export const JS_RUNTIME_NAME = '$x';

/**
 * The runtime the emitted code calls, as JavaScript source that declares
 * `const $x`. Emit it once in a module before compiled expressions.
 */
export const JS_RUNTIME = `const ${JS_RUNTIME_NAME} = (() => {
  const P10 = [1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22];
  const SPACE = /^[ \\t\\n\\r\\f\\v]+|[ \\t\\n\\r\\f\\v]+$/g;
  const INTEGER = /^([+-]?)([0-9]+)$/;
  const DECIMAL = /^([+-]?)(?:([0-9]+)(?:\\.([0-9]*))?|\\.([0-9]+))(?:[eE]([+-]?[0-9]+))?$/;
  const round = (x) => (x < 0 ? -Math.round(-x) : Math.round(x));
  const trim = (s) => s.replace(SPACE, '');
  const decimal = (text) => {
    const match = DECIMAL.exec(trim(text));
    if (match === null) return null;
    const fraction = match[3] ?? match[4] ?? '';
    let digits = (match[2] ?? '') + fraction;
    const exponentText = match[5] ?? '0';
    let exponent = exponentText.replace(/^[+-]?0*/, '').length > 6 ? (exponentText[0] === '-' ? -100000 : 100000) : Number(exponentText);
    exponent -= fraction.length;
    digits = digits.replace(/^0+/, '');
    let value;
    if (digits === '') value = 0;
    else {
      const trailing = /0*$/.exec(digits)[0].length;
      digits = digits.slice(0, digits.length - trailing);
      exponent += trailing;
      if (digits.length > 19) {
        exponent += digits.length - 19;
        digits = digits.slice(0, 19);
      }
      value = Number(BigInt(digits));
      while (exponent > 22 && value !== Infinity) { value *= 1e22; exponent -= 22; }
      while (exponent < -22 && value !== 0) { value /= 1e22; exponent += 22; }
      if (exponent > 22) value = Infinity;
      else if (exponent < -22) value = 0;
      else value = exponent >= 0 ? value * P10[exponent] : value / P10[-exponent];
    }
    return match[1] === '-' ? -value : value;
  };
  return {
    f32: Math.fround,
    round,
    trim,
    lower: (s) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32)),
    removeSuffix: (s, suffix) => (s.endsWith(suffix) ? s.slice(0, s.length - suffix.length) : s),
    w8: (x) => (x << 24) >> 24,
    wu8: (x) => x & 0xff,
    w16: (x) => (x << 16) >> 16,
    wu16: (x) => x & 0xffff,
    w32: (x) => x | 0,
    wu32: (x) => x >>> 0,
    i64: (x) => BigInt.asIntN(64, x),
    u64: (x) => BigInt.asUintN(64, x),
    idiv: (a, b) => (b === 0 ? 0 : Math.trunc(a / b)),
    bdiv: (a, b) => (b === 0n ? 0n : a / b),
    bmin: (a, b) => (a < b ? a : b),
    bmax: (a, b) => (a > b ? a : b),
    toInt: (x, lo, hi) => (x !== x ? 0 : x <= lo ? lo : x >= hi + 1 ? hi : Math.trunc(x) + 0),
    toBig: (x, lo, hi, limit) => (x !== x ? 0n : x <= Number(lo) ? lo : x >= limit ? hi : BigInt(Math.trunc(x))),
    fixed: (x, digits) => {
      if (x !== x) return 'NaN';
      if (x === Infinity || x === -Infinity) return x < 0 ? '-Infinity' : 'Infinity';
      const scaled = x * P10[digits];
      if (scaled === Infinity || scaled === -Infinity) return x < 0 ? '-Infinity' : 'Infinity';
      const n = round(scaled);
      let text = BigInt(Math.abs(n)).toString();
      if (digits > 0) {
        text = text.padStart(digits + 1, '0');
        text = text.slice(0, text.length - digits) + '.' + text.slice(text.length - digits);
      }
      return n < 0 ? '-' + text : text;
    },
    fixedInt: (x, digits) => String(x) + (digits > 0 ? '.' + '0'.repeat(digits) : ''),
    parseInt: (text, lo, hi, big) => {
      const match = INTEGER.exec(trim(text));
      if (match === null) return null;
      const value = BigInt(match[1] + match[2]);
      if (value < lo || value > hi) return null;
      return big ? value : Number(value);
    },
    parseFloat: (text, single) => {
      let value = decimal(text);
      if (value === null) return null;
      if (single) value = Math.fround(value);
      return value === Infinity || value === -Infinity ? null : value;
    },
  };
})();
`;

export interface CompileJsOptions {
  /** The JavaScript identifier of each input; by default its name. */
  readonly names?: Readonly<Record<string, string>>;
}

/**
 * The JavaScript expression that computes `expression` from its `inputs`.
 * Checks the tree first; throws `ExpressionError` for an invalid one.
 */
export function compileJs(
  expression: unknown,
  inputs: ExpressionInputs,
  options: CompileJsOptions = {},
): string {
  assertExpression(expression, inputs);
  return emit(expression, (name) => {
    const identifier = options.names?.[name] ?? name;
    if (!/^[A-Za-z_$][\w$]*$/.test(identifier))
      throw new TypeError(`'${identifier}' is not a JavaScript identifier`);
    return identifier;
  });
}

/**
 * A function that evaluates `expression`, its arguments the inputs in the
 * order of `inputs`' keys. Builds it with `Function`, so where code
 * generation is not allowed (a strict CSP), emit a module with
 * {@link compileJs} instead.
 */
export function compileJsFunction(
  expression: unknown,
  inputs: ExpressionInputs,
): (...values: unknown[]) => unknown {
  const names = Object.keys(inputs).map((_, index) => `a${index}`);
  const body = compileJs(expression, inputs, {
    names: Object.fromEntries(
      Object.keys(inputs).map((name, index) => [name, names[index]!]),
    ),
  });
  return new Function(
    `${JS_RUNTIME}return (${names.join(', ')}) => ${body};`,
  )() as (...values: unknown[]) => unknown;
}

const R = JS_RUNTIME_NAME;

const WRAP: Record<Exclude<IntegerType, 'int64' | 'uint64'>, string> = {
  int8: 'w8',
  uint8: 'wu8',
  int16: 'w16',
  uint16: 'wu16',
  int32: 'w32',
  uint32: 'wu32',
};

/** Wraps a JavaScript value of an integer computation into its type. */
function wrap(type: IntegerType, code: string): string {
  if (type === 'int64') return `${R}.i64(${code})`;
  if (type === 'uint64') return `${R}.u64(${code})`;
  return `${R}.${WRAP[type]}(${code})`;
}

function literal(
  type: ExpressionType,
  value: number | string | boolean | null,
): string {
  if (value === null) return 'null';
  const base = baseType(type);
  if (base === 'string') return JSON.stringify(value);
  if (base === 'boolean') return value ? 'true' : 'false';
  if (isBigIntType(base)) return `${String(value)}n`;
  const number =
    base === 'float32' ? Math.fround(value as number) : (value as number);
  return number < 0 ? `(${String(number)})` : String(number);
}

function emit(node: ExpressionNode, name: (input: string) => string): string {
  const go = (child: ExpressionNode) => emit(child, name);
  switch (node.kind) {
    case 'literal':
      return literal(node.type, node.value);
    case 'input':
      return name(node.name);
    case 'variable':
      return `$m${node.name}`;
    case 'unary': {
      const a = go(node.operand);
      const type = node.operand.type;
      switch (node.operator) {
        case 'not':
          return `(!${a})`;
        case 'trim':
          return `${R}.trim(${a})`;
        case 'lower':
          return `${R}.lower(${a})`;
        case 'neg':
          if (isIntegerType(type)) return wrap(type, `-${a}`);
          return `(-${a})`;
        case 'abs':
          if (type === 'int64') return `${R}.i64(${a} < 0n ? -${a} : ${a})`;
          if (type === 'uint64') return a;
          if (isIntegerType(type)) return wrap(type, `Math.abs(${a})`);
          return `Math.abs(${a})`;
        case 'round':
          return `${R}.round(${a})`;
        default: {
          const fn = `Math.${node.operator}(${a})`;
          return type === 'float32' ? `${R}.f32(${fn})` : fn;
        }
      }
    }
    case 'binary': {
      const a = go(node.left);
      const b = go(node.right);
      const type = node.left.type;
      const op = BINARY_JS[node.operator];
      switch (node.operator) {
        case 'endsWith':
          return `${a}.endsWith(${b})`;
        case 'removeSuffix':
          return `${R}.removeSuffix(${a}, ${b})`;
        case 'eq':
        case 'ne':
        case 'lt':
        case 'lte':
        case 'gt':
        case 'gte':
        case 'and':
        case 'or':
          return `(${a} ${op} ${b})`;
        case 'pow':
          return type === 'float32'
            ? `${R}.f32(Math.pow(${a}, ${b}))`
            : `Math.pow(${a}, ${b})`;
        case 'min':
        case 'max':
          if (isBigIntType(type)) return `${R}.b${node.operator}(${a}, ${b})`;
          return `Math.${node.operator}(${a}, ${b})`;
        default:
          break;
      }
      if (isFloatType(type)) {
        const code = `(${a} ${op} ${b})`;
        return type === 'float32' ? `${R}.f32${code}` : code;
      }
      const integer = type as IntegerType;
      if (isBigIntType(integer)) {
        if (node.operator === 'div')
          return wrap(integer, `${R}.bdiv(${a}, ${b})`);
        return wrap(integer, `${a} ${op} ${b}`);
      }
      if (node.operator === 'div')
        return wrap(integer, `${R}.idiv(${a}, ${b})`);
      if (node.operator === 'mul' && INTEGERS[integer].bits === 32)
        return wrap(integer, `Math.imul(${a}, ${b})`);
      return wrap(integer, `${a} ${op} ${b}`);
    }
    case 'if':
      return `(${go(node.condition)} ? ${go(node.then)} : ${go(node.else)})`;
    case 'convert':
      return convert(
        go(node.operand),
        node.operand.type as NumericType,
        node.type,
      );
    case 'fixed': {
      const a = go(node.operand);
      return isFloatType(node.operand.type)
        ? `${R}.fixed(${a}, ${node.digits})`
        : `${R}.fixedInt(${a}, ${node.digits})`;
    }
    case 'concat':
      return node.operands.length === 1
        ? go(node.operands[0]!)
        : `(${node.operands.map(go).join(' + ')})`;
    case 'parse': {
      const a = go(node.operand);
      const type = baseType(node.type) as NumericType;
      if (isFloatType(type))
        return `${R}.parseFloat(${a}, ${type === 'float32'})`;
      const { min, max } = INTEGERS[type];
      return `${R}.parseInt(${a}, ${min}n, ${max}n, ${isBigIntType(type)})`;
    }
    case 'coalesce':
      return `(${go(node.operand)} ?? ${go(node.fallback)})`;
    case 'isNull':
      return `(${go(node.operand)} === null)`;
    case 'let':
      return `((${'$m'}${node.variable}) => ${go(node.body)})(${go(node.value)})`;
    case 'map': {
      const variable = `$m${node.variable}`;
      return `((${variable}) => ${variable} === null ? null : ${go(node.body)})(${go(node.operand)})`;
    }
  }
}

const BINARY_JS: Record<string, string> = {
  add: '+',
  sub: '-',
  mul: '*',
  div: '/',
  eq: '===',
  ne: '!==',
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>=',
  and: '&&',
  or: '||',
};

function convert(code: string, from: NumericType, to: NumericType): string {
  if (from === to) return code;
  if (isFloatType(to)) {
    const number = isBigIntType(from) ? `Number(${code})` : code;
    return to === 'float32' ? `${R}.f32(${number})` : number;
  }
  const { min, max, bits, signed } = INTEGERS[to];
  if (isFloatType(from)) {
    if (isBigIntType(to))
      return `${R}.toBig(${code}, ${min}n, ${max}n, ${2 ** (signed ? bits - 1 : bits)})`;
    return `${R}.toInt(${code}, ${min}, ${max})`;
  }
  // Integer to integer: two's complement wrap-around.
  if (isBigIntType(to))
    return wrap(to, isBigIntType(from) ? code : `BigInt(${code})`);
  if (isBigIntType(from))
    return `Number(BigInt.as${signed ? 'Int' : 'Uint'}N(${bits}, ${code}))`;
  return wrap(to, code);
}
