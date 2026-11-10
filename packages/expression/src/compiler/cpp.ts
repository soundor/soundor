/**
 * Compiles expressions to C++17: a C++ expression per tree, over helpers
 * ({@link cppRuntime}) that give it the language's semantics — the same as the
 * JavaScript compiler's, operation for operation. The output is plain C++ of
 * the standard library: no framework, no allocation except for strings, no
 * exceptions; reusable by any C++ plugin framework.
 *
 * Emit {@link CPP_PRAGMAS} at the top of the file and {@link CPP_INCLUDES},
 * then `cppRuntime()` in the namespace the compiled code is in. The pragmas
 * stop the compiler from fusing a multiplication and an addition (which
 * JavaScript never does), so both languages compute the same bits. Code
 * built with `-ffast-math` does not have these semantics.
 */

import type { ExpressionNode } from '../ast';
import { assertExpression, type ExpressionInputs } from '../check';
import {
  INTEGERS,
  baseType,
  isFloatType,
  isIntegerType,
  isNullableType,
  type ExpressionType,
  type IntegerType,
  type NumericType,
} from '../types';

/** The namespace {@link cppRuntime} declares, which compiled code calls. */
export const CPP_RUNTIME_NAMESPACE = 'soundor_expression';

/** The headers compiled code and the runtime need. */
export const CPP_INCLUDES: readonly string[] = [
  '<cmath>',
  '<cstddef>',
  '<cstdint>',
  '<cstdio>',
  '<limits>',
  '<optional>',
  '<string>',
  '<string_view>',
  '<type_traits>',
];

/** File-scope pragmas: no floating-point contraction in this file. */
export const CPP_PRAGMAS = `#if defined(__clang__)
#pragma clang fp contract(off)
#elif defined(__GNUC__)
#pragma GCC optimize("fp-contract=off")
#elif defined(_MSC_VER)
#pragma fp_contract(off)
#endif
`;

const N = CPP_RUNTIME_NAMESPACE;

/** The C++ type of an expression type. */
export function cppType(type: ExpressionType): string {
  if (isNullableType(type)) return `std::optional<${cppType(baseType(type))}>`;
  switch (type) {
    case 'boolean':
      return 'bool';
    case 'string':
      return 'std::string';
    case 'float32':
      return 'float';
    case 'float64':
      return 'double';
    default:
      return `std::${type}_t`;
  }
}

/** The helpers compiled code calls, in `namespace soundor_expression`. */
export function cppRuntime(): string {
  return `namespace ${N}
{
    constexpr double pow10[] = { 1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11,
                                 1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22 };

    // Integers wrap around (two's complement): computed modulo 2^64.
    template <class T> inline T iadd(T a, T b) noexcept { return static_cast<T>(static_cast<std::uint64_t>(a) + static_cast<std::uint64_t>(b)); }
    template <class T> inline T isub(T a, T b) noexcept { return static_cast<T>(static_cast<std::uint64_t>(a) - static_cast<std::uint64_t>(b)); }
    template <class T> inline T imul(T a, T b) noexcept { return static_cast<T>(static_cast<std::uint64_t>(a) * static_cast<std::uint64_t>(b)); }
    template <class T> inline T ineg(T a) noexcept { return static_cast<T>(std::uint64_t { 0 } - static_cast<std::uint64_t>(a)); }
    template <class T> inline T iabs(T a) noexcept
    {
        if constexpr (std::is_signed_v<T>)
            return a < 0 ? ineg(a) : a;
        else
            return a;
    }
    // Truncates toward zero; by zero gives 0, and the minimum by -1 wraps.
    template <class T> inline T idiv(T a, T b) noexcept
    {
        if (b == 0)
            return 0;
        if constexpr (std::is_signed_v<T>)
            if (a == std::numeric_limits<T>::min() && b == -1)
                return a;
        return static_cast<T>(a / b);
    }
    template <class T> inline T imin(T a, T b) noexcept { return b < a ? b : a; }
    template <class T> inline T imax(T a, T b) noexcept { return a < b ? b : a; }

    // JavaScript's Math.min and Math.max: NaN wins, -0 is below +0.
    template <class F> inline F fmin(F a, F b) noexcept
    {
        if (a != a || b != b)
            return std::numeric_limits<F>::quiet_NaN();
        if (a == b)
            return std::signbit(a) ? a : b;
        return a < b ? a : b;
    }
    template <class F> inline F fmax(F a, F b) noexcept
    {
        if (a != a || b != b)
            return std::numeric_limits<F>::quiet_NaN();
        if (a == b)
            return std::signbit(a) ? b : a;
        return a < b ? b : a;
    }

    // To the nearest binary32, overflowing to infinity (as Math.fround).
    inline float f32(double x) noexcept
    {
        constexpr double overflow = 3.4028235677973366e38; // halfway between FLT_MAX and 2^128
        if (x >= overflow)
            return std::numeric_limits<float>::infinity();
        if (x <= -overflow)
            return -std::numeric_limits<float>::infinity();
        return static_cast<float>(x);
    }
    template <class F> inline F narrow(double x) noexcept
    {
        if constexpr (std::is_same_v<F, float>)
            return f32(x);
        else
            return x;
    }
    template <class F> inline F fsqrt(F x) noexcept { return narrow<F>(std::sqrt(static_cast<double>(x))); }
    template <class F> inline F fexp(F x) noexcept { return narrow<F>(std::exp(static_cast<double>(x))); }
    template <class F> inline F flog(F x) noexcept { return narrow<F>(std::log(static_cast<double>(x))); }
    // Math.pow: NaN for a NaN exponent, and for ±1 to an infinite power.
    template <class F> inline F fpow(F a, F b) noexcept
    {
        const double x = a;
        const double y = b;
        if (y != y || ((x == 1.0 || x == -1.0) && std::isinf(y)))
            return std::numeric_limits<F>::quiet_NaN();
        return narrow<F>(std::pow(x, y));
    }

    // Toward zero, saturated, NaN to 0.
    template <class T, class F> inline T toInt(F value) noexcept
    {
        const double x = static_cast<double>(value);
        if (x != x)
            return 0;
        constexpr double low = static_cast<double>(std::numeric_limits<T>::min());
        constexpr double limit = std::is_signed_v<T> ? -low : 2.0 * (static_cast<double>(std::numeric_limits<T>::max() / 2) + 1.0);
        if (x <= low)
            return std::numeric_limits<T>::min();
        if (x >= limit)
            return std::numeric_limits<T>::max();
        return static_cast<T>(std::trunc(x));
    }

    inline std::string fixedFloat(double x, int digits)
    {
        if (x != x)
            return "NaN";
        if (std::isinf(x))
            return x < 0 ? "-Infinity" : "Infinity";
        const double scaled = x * pow10[digits];
        if (std::isinf(scaled))
            return x < 0 ? "-Infinity" : "Infinity";
        const double n = std::round(scaled);
        const double magnitude = std::fabs(n);
        std::string text;
        if (magnitude < 18446744073709551616.0)
            text = std::to_string(static_cast<unsigned long long>(magnitude));
        else
        {
            char buffer[512];
            std::snprintf(buffer, sizeof buffer, "%.0f", magnitude);
            text = buffer;
        }
        if (digits > 0)
        {
            const auto width = static_cast<std::size_t>(digits) + 1;
            if (text.size() < width)
                text.insert(0, width - text.size(), '0');
            text.insert(text.size() - static_cast<std::size_t>(digits), 1, '.');
        }
        if (n < 0)
            text.insert(0, 1, '-');
        return text;
    }

    template <class T> inline std::string fixedInt(T x, int digits)
    {
        std::string text = std::to_string(x);
        if (digits > 0)
        {
            text += '.';
            text.append(static_cast<std::size_t>(digits), '0');
        }
        return text;
    }

    inline bool isSpace(char c) noexcept { return c == ' ' || c == '\\t' || c == '\\n' || c == '\\r' || c == '\\f' || c == '\\v'; }
    inline bool isDigit(char c) noexcept { return c >= '0' && c <= '9'; }

    inline std::string_view trimView(std::string_view text) noexcept
    {
        while (! text.empty() && isSpace(text.front()))
            text.remove_prefix(1);
        while (! text.empty() && isSpace(text.back()))
            text.remove_suffix(1);
        return text;
    }
    inline std::string trim(std::string_view text) { return std::string(trimView(text)); }
    inline std::string lower(std::string text)
    {
        for (char& c : text)
            if (c >= 'A' && c <= 'Z')
                c = static_cast<char>(c - 'A' + 'a');
        return text;
    }
    inline bool endsWith(std::string_view text, std::string_view suffix) noexcept
    {
        return text.size() >= suffix.size() && text.substr(text.size() - suffix.size()) == suffix;
    }
    inline std::string removeSuffix(std::string_view text, std::string_view suffix)
    {
        return std::string(endsWith(text, suffix) ? text.substr(0, text.size() - suffix.size()) : text);
    }

    template <class T> inline std::optional<T> parseInt(std::string_view text) noexcept
    {
        text = trimView(text);
        std::size_t i = 0;
        bool negative = false;
        if (i < text.size() && (text[i] == '+' || text[i] == '-'))
            negative = text[i++] == '-';
        if (i == text.size())
            return std::nullopt;
        std::uint64_t magnitude = 0;
        bool overflow = false;
        for (; i < text.size(); ++i)
        {
            if (! isDigit(text[i]))
                return std::nullopt;
            const auto digit = static_cast<std::uint64_t>(text[i] - '0');
            if (magnitude > (std::numeric_limits<std::uint64_t>::max() - digit) / 10)
                overflow = true;
            else
                magnitude = magnitude * 10 + digit;
        }
        if (overflow)
            return std::nullopt;
        if (negative)
        {
            if constexpr (std::is_signed_v<T>)
            {
                const auto limit = static_cast<std::uint64_t>(-(std::numeric_limits<T>::min() + 1)) + 1;
                if (magnitude > limit)
                    return std::nullopt;
                return static_cast<T>(std::uint64_t { 0 } - magnitude);
            }
            else
            {
                if (magnitude != 0)
                    return std::nullopt;
                return T { 0 };
            }
        }
        if (magnitude > static_cast<std::uint64_t>(std::numeric_limits<T>::max()))
            return std::nullopt;
        return static_cast<T>(magnitude);
    }

    // Decimal notation to a double, by the same operations as the JavaScript
    // runtime (exact for up to 15 significant digits and exponents to ±22).
    inline std::optional<double> parseDecimal(std::string_view text) noexcept
    {
        text = trimView(text);
        std::size_t i = 0;
        bool negative = false;
        if (i < text.size() && (text[i] == '+' || text[i] == '-'))
            negative = text[i++] == '-';
        const std::size_t integerStart = i;
        while (i < text.size() && isDigit(text[i]))
            ++i;
        const std::string_view integerDigits = text.substr(integerStart, i - integerStart);
        std::string_view fractionDigits;
        if (i < text.size() && text[i] == '.')
        {
            const std::size_t fractionStart = ++i;
            while (i < text.size() && isDigit(text[i]))
                ++i;
            fractionDigits = text.substr(fractionStart, i - fractionStart);
        }
        if (integerDigits.empty() && fractionDigits.empty())
            return std::nullopt;
        long exponent = 0;
        if (i < text.size() && (text[i] == 'e' || text[i] == 'E'))
        {
            ++i;
            bool exponentNegative = false;
            if (i < text.size() && (text[i] == '+' || text[i] == '-'))
                exponentNegative = text[i++] == '-';
            const std::size_t exponentStart = i;
            while (i < text.size() && isDigit(text[i]))
                ++i;
            if (i == exponentStart)
                return std::nullopt;
            std::size_t first = exponentStart;
            while (first < i && text[first] == '0')
                ++first;
            if (i - first > 6)
                exponent = 100000;
            else
                for (std::size_t k = first; k < i; ++k)
                    exponent = exponent * 10 + (text[k] - '0');
            if (exponentNegative)
                exponent = -exponent;
        }
        if (i != text.size())
            return std::nullopt;
        exponent -= static_cast<long>(fractionDigits.size());

        std::string digits;
        digits.reserve(integerDigits.size() + fractionDigits.size());
        digits.append(integerDigits);
        digits.append(fractionDigits);
        std::size_t start = 0;
        while (start < digits.size() && digits[start] == '0')
            ++start;
        std::size_t end = digits.size();
        double value = 0;
        if (start < end)
        {
            while (digits[end - 1] == '0')
            {
                --end;
                ++exponent;
            }
            if (end - start > 19)
            {
                exponent += static_cast<long>(end - start - 19);
                end = start + 19;
            }
            std::uint64_t mantissa = 0;
            for (std::size_t k = start; k < end; ++k)
                mantissa = mantissa * 10 + static_cast<std::uint64_t>(digits[k] - '0');
            value = static_cast<double>(mantissa);
            while (exponent > 22 && ! std::isinf(value))
            {
                value *= 1e22;
                exponent -= 22;
            }
            while (exponent < -22 && value != 0)
            {
                value /= 1e22;
                exponent += 22;
            }
            if (exponent > 22)
                value = std::numeric_limits<double>::infinity();
            else if (exponent < -22)
                value = 0;
            else
                value = exponent >= 0 ? value * pow10[exponent] : value / pow10[-exponent];
        }
        return negative ? -value : value;
    }

    template <class F> inline std::optional<F> parseFloat(std::string_view text) noexcept
    {
        const auto value = parseDecimal(text);
        if (! value)
            return std::nullopt;
        const F result = narrow<F>(*value);
        if (std::isinf(result))
            return std::nullopt;
        return result;
    }
} // namespace ${N}
`;
}

export interface CompileCppOptions {
  /** The C++ name of each input; by default its name. */
  readonly names?: Readonly<Record<string, string>>;
}

/**
 * The C++ expression that computes `expression` from its `inputs` (of the C++
 * types {@link cppType} gives). Checks the tree first; throws
 * `ExpressionError` for an invalid one.
 */
export function compileCpp(
  expression: unknown,
  inputs: ExpressionInputs,
  options: CompileCppOptions = {},
): string {
  assertExpression(expression, inputs);
  return emit(expression, (name) => {
    const identifier = options.names?.[name] ?? name;
    if (!/^[A-Za-z_][\w]*$/.test(identifier))
      throw new TypeError(`'${identifier}' is not a C++ identifier`);
    return identifier;
  });
}

/** A C++ string literal of `value`'s UTF-8 bytes, as a `std::string`. */
export function cppStringLiteral(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let body = '';
  for (const byte of bytes) {
    if (byte === 0x22) body += '\\"';
    else if (byte === 0x5c) body += '\\\\';
    else if (byte === 0x3f) body += '\\?';
    else if (byte >= 0x20 && byte < 0x7f) body += String.fromCharCode(byte);
    else body += `\\${byte.toString(8).padStart(3, '0')}`;
  }
  return `"${body}"`;
}

function floatLiteral(type: 'float32' | 'float64', value: number): string {
  const number = type === 'float32' ? Math.fround(value) : value;
  let text = String(number);
  if (!/[.e]/.test(text)) text += '.0';
  if (type === 'float32') text += 'f';
  return number < 0 ? `(${text})` : text;
}

function integerLiteral(type: IntegerType, value: number | string): string {
  const integer = BigInt(value);
  if (type === 'uint64') return `std::uint64_t { ${integer}ULL }`;
  if (type === 'int64') {
    return integer === INTEGERS.int64.min
      ? '(-9223372036854775807LL - 1)'
      : `std::int64_t { ${integer}LL }`;
  }
  return `static_cast<${cppType(type)}>(${integer}LL)`;
}

function literal(
  type: ExpressionType,
  value: number | string | boolean | null,
): string {
  if (value === null) return `${cppType(type)}()`;
  const base = baseType(type);
  if (base === 'string')
    return `std::string(${cppStringLiteral(value as string)}, ${new TextEncoder().encode(value as string).length})`;
  if (base === 'boolean') return value ? 'true' : 'false';
  if (isFloatType(base)) return floatLiteral(base, value as number);
  return integerLiteral(base as IntegerType, value as number | string);
}

const COMPARISON: Record<string, string> = {
  eq: '==',
  ne: '!=',
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>=',
  and: '&&',
  or: '||',
};

const FLOAT_OPERATOR: Record<string, string> = {
  add: '+',
  sub: '-',
  mul: '*',
  div: '/',
};

/** Code of type `node.type`, as `as` when that is the nullable of it. */
function as(code: string, from: ExpressionType, to: ExpressionType): string {
  return from === to ? code : `${cppType(to)}(${code})`;
}

function emit(node: ExpressionNode, name: (input: string) => string): string {
  const go = (child: ExpressionNode) => emit(child, name);
  switch (node.kind) {
    case 'literal':
      return literal(node.type, node.value);
    case 'input':
      return name(node.name);
    case 'variable':
      return `m_${node.name}`;
    case 'unary': {
      const a = go(node.operand);
      const type = node.operand.type;
      const t = cppType(type);
      switch (node.operator) {
        case 'not':
          return `(! ${a})`;
        case 'trim':
          return `${N}::trim(${a})`;
        case 'lower':
          return `${N}::lower(${a})`;
        case 'neg':
          return isIntegerType(type) ? `${N}::ineg<${t}>(${a})` : `(-${a})`;
        case 'abs':
          return isIntegerType(type)
            ? `${N}::iabs<${t}>(${a})`
            : `std::fabs(${a})`;
        case 'floor':
        case 'ceil':
        case 'round':
          return `static_cast<${t}>(std::${node.operator}(${a}))`;
        default:
          return `${N}::f${node.operator}<${t}>(${a})`;
      }
    }
    case 'binary': {
      const a = go(node.left);
      const b = go(node.right);
      const type = node.left.type;
      const t = cppType(type);
      switch (node.operator) {
        case 'endsWith':
          return `${N}::endsWith(${a}, ${b})`;
        case 'removeSuffix':
          return `${N}::removeSuffix(${a}, ${b})`;
        case 'pow':
          return `${N}::fpow<${t}>(${a}, ${b})`;
        case 'min':
        case 'max':
          return `${N}::${isIntegerType(type) ? 'i' : 'f'}${node.operator}<${t}>(${a}, ${b})`;
        case 'add':
        case 'sub':
        case 'mul':
        case 'div':
          if (isIntegerType(type))
            return `${N}::i${node.operator}<${t}>(${a}, ${b})`;
          return `static_cast<${t}>(${a} ${FLOAT_OPERATOR[node.operator]} ${b})`;
        default:
          return `(${a} ${COMPARISON[node.operator]} ${b})`;
      }
    }
    case 'if':
      return `(${go(node.condition)} ? ${as(go(node.then), node.then.type, node.type)} : ${as(go(node.else), node.else.type, node.type)})`;
    case 'convert':
      return convert(
        go(node.operand),
        node.operand.type as NumericType,
        node.type,
      );
    case 'fixed': {
      const a = go(node.operand);
      return isFloatType(node.operand.type)
        ? `${N}::fixedFloat(static_cast<double>(${a}), ${node.digits})`
        : `${N}::fixedInt(${a}, ${node.digits})`;
    }
    case 'concat':
      return node.operands.length === 1
        ? go(node.operands[0]!)
        : `(${node.operands.map(go).join(' + ')})`;
    case 'parse': {
      const type = baseType(node.type) as NumericType;
      return `${N}::parse${isFloatType(type) ? 'Float' : 'Int'}<${cppType(type)}>(${go(node.operand)})`;
    }
    case 'coalesce':
      return `(${go(node.operand)}).value_or(${go(node.fallback)})`;
    case 'isNull':
      return `(! (${go(node.operand)}).has_value())`;
    case 'let': {
      const inner = cppType(node.value.type);
      return `[&](const ${inner} m_${node.variable}) -> ${cppType(node.type)} { return ${go(node.body)}; }(${go(node.value)})`;
    }
    case 'map': {
      const inner = cppType(baseType(node.operand.type));
      return `[&](const std::optional<${inner}>& o_${node.variable}) -> ${cppType(node.type)} { if (! o_${node.variable}) return std::nullopt; const ${inner} m_${node.variable} = *o_${node.variable}; return ${go(node.body)}; }(${go(node.operand)})`;
    }
  }
}

function convert(code: string, from: NumericType, to: NumericType): string {
  if (from === to) return code;
  const target = cppType(to);
  if (to === 'float32') return `${N}::f32(static_cast<double>(${code}))`;
  if (to === 'float64') return `static_cast<double>(${code})`;
  if (isFloatType(from)) return `${N}::toInt<${target}>(${code})`;
  return `static_cast<${target}>(${code})`;
}
