import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { arch, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { corpus } from './__tests__/corpus';
import { createContext, expressions as e } from './builder';
import { ExpressionError } from './check';
import {
  CPP_INCLUDES,
  CPP_PRAGMAS,
  compileCpp,
  cppRuntime,
  cppStringLiteral,
  cppType,
} from './compiler/cpp';
import { compileJs, compileJsFunction, JS_RUNTIME } from './compiler/js';
import {
  baseType,
  isBigIntType,
  isFloatType,
  isNullableType,
  type ExpressionType,
} from './types';

/** An input as the language holds it: float32 inputs are binary32 values. */
function inputValue(type: ExpressionType, value: unknown): unknown {
  return type === 'float32' ? Math.fround(value as number) : value;
}

function evaluate(index: number, values: readonly unknown[]): unknown {
  const test = corpus[index]!;
  const fn = compileJsFunction(test.expression, test.inputs);
  const types = Object.values(test.inputs);
  return fn(...values.map((value, i) => inputValue(types[i]!, value)));
}

/** One canonical line per value, written the same way by both languages. */
function encode(type: ExpressionType, value: unknown): string {
  if (value === null) return 'null';
  const base = baseType(type);
  if (base === 'boolean') return value ? 'true' : 'false';
  if (base === 'string')
    return `s:${[...new TextEncoder().encode(value as string)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  if (isFloatType(base)) {
    const number = value as number;
    if (Number.isNaN(number)) return 'NaN';
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, number);
    return view.getBigUint64(0).toString(16).padStart(16, '0');
  }
  return String(value);
}

describe('the JavaScript compiler', () => {
  corpus.forEach((test, index) => {
    const pinned = test.samples.filter((sample) => sample.length > 1);
    if (pinned.length === 0) return;
    it(test.name, () => {
      for (const [values, expected] of pinned) {
        const result = evaluate(index, values);
        if (typeof expected === 'number' && Number.isNaN(expected))
          expect(result, `${JSON.stringify(values, replacer)}`).toBeNaN();
        else
          expect(result, `${JSON.stringify(values, replacer)}`).toStrictEqual(
            expected,
          );
      }
    });
  });

  it('emits a module that runs on its own', () => {
    const format = e.concat(
      e.fixed(createContext({ value: 'float32' }).value, 1),
      ' dB',
    );
    const code = `${JS_RUNTIME}return (value) => ${compileJs(format, { value: 'float32' })};`;
    expect((new Function(code)() as (v: number) => string)(-3.25)).toBe(
      '-3.3 dB',
    );
  });

  it('names inputs as asked', () => {
    const { value } = createContext({ value: 'int32' });
    expect(
      compileJs(e.add(value, 1), { value: 'int32' }, { names: { value: 'v' } }),
    ).toBe('$x.w32(v + 1)');
  });

  it('refuses an invalid tree', () => {
    expect(() =>
      compileJs(
        {
          kind: 'binary',
          type: 'float32',
          operator: 'add',
          left: e.float32(1),
          right: e.int32(1),
        },
        {},
      ),
    ).toThrow(ExpressionError);
    expect(() => compileJs(e.float32(1), {}, { names: {} })).not.toThrow();
  });
});

describe('the C++ compiler', () => {
  it('writes string literals of UTF-8 bytes', () => {
    expect(cppStringLiteral('a"\\?é\n')).toBe('"a\\"\\\\\\?\\303\\251\\012"');
  });

  it('maps types', () => {
    expect(cppType('uint16')).toBe('std::uint16_t');
    expect(cppType('float32?')).toBe('std::optional<float>');
    expect(cppType('string')).toBe('std::string');
  });
});

const compiler = process.env['CXX'] ?? 'c++';
const hasCompiler = spawnSync(compiler, ['--version']).status === 0;
if (!hasCompiler && process.env['CI'])
  throw new Error(
    `The C++/JavaScript differential test needs a C++ compiler (${compiler}) in CI.`,
  );

describe.runIf(hasCompiler)('C++ and JavaScript', () => {
  const dir = mkdtempSync(join(tmpdir(), 'soundor-expression-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function cppValue(type: ExpressionType, value: unknown): string {
    if (value === null) return `${cppType(type)}()`;
    const base = baseType(type);
    if (base === 'string') {
      const bytes = new TextEncoder().encode(value as string).length;
      return `std::string(${cppStringLiteral(value as string)}, ${bytes})`;
    }
    if (base === 'boolean') return value ? 'true' : 'false';
    if (isFloatType(base)) {
      const number = value as number;
      const limits = `std::numeric_limits<${cppType(base)}>`;
      if (Number.isNaN(number)) return `${limits}::quiet_NaN()`;
      if (number === Infinity) return `${limits}::infinity()`;
      if (number === -Infinity) return `-${limits}::infinity()`;
      if (Object.is(number, -0)) return `-${cppType(base)}(0)`;
      const text = String(base === 'float32' ? Math.fround(number) : number);
      return `${cppType(base)}(${text}${/[.e]/.test(text) ? '' : '.0'})`;
    }
    if (base === 'int64' && (value as bigint) === -(2n ** 63n))
      return 'std::numeric_limits<std::int64_t>::min()';
    return `static_cast<${cppType(base)}>(${String(value)}${isBigIntType(base) ? (base === 'uint64' ? 'ULL' : 'LL') : 'LL'})`;
  }

  it('compute the same bits for the whole corpus', () => {
    const lines: string[] = [];
    const expected: string[] = [];
    corpus.forEach((test, index) => {
      const types = Object.values(test.inputs);
      const names = Object.keys(test.inputs);
      const body = compileCpp(test.expression, test.inputs);
      test.samples.forEach(([values], sample) => {
        const bindings = names.map(
          (name, i) =>
            `const ${cppType(types[i]!)} ${name} = opaque(${cppValue(types[i]!, values[i])});`,
        );
        lines.push(
          `    { ${bindings.join(' ')} put("${index}:${sample}", ${body}); }`,
        );
        expected.push(
          `${index}:${sample}:${encode(test.expression.type, evaluate(index, values))}`,
        );
      });
    });
    const source = `${CPP_PRAGMAS}
${CPP_INCLUDES.map((header) => `#include ${header}`).join('\n')}
#include <cstring>

${cppRuntime()}

// Hides inputs from the optimizer, so it computes at run time (and could fuse).
template <class T> [[gnu::noinline]] static T opaque(T value)
{
    asm volatile("" : : "r"(&value) : "memory");
    return value;
}

static void line(const char* key, const std::string& text) { std::printf("%s:%s\\n", key, text.c_str()); }
static void put(const char* key, double v)
{
    if (v != v) return line(key, "NaN");
    std::uint64_t bits;
    std::memcpy(&bits, &v, sizeof bits);
    char buffer[32];
    std::snprintf(buffer, sizeof buffer, "%016llx", static_cast<unsigned long long>(bits));
    line(key, buffer);
}
static void put(const char* key, float v) { put(key, static_cast<double>(v)); }
static void put(const char* key, bool v) { line(key, v ? "true" : "false"); }
static void put(const char* key, const std::string& v)
{
    std::string text = "s:";
    char buffer[4];
    for (unsigned char c : v)
    {
        std::snprintf(buffer, sizeof buffer, "%02x", c);
        text += buffer;
    }
    line(key, text);
}
template <class T, std::enable_if_t<std::is_integral_v<T> && ! std::is_same_v<T, bool>, int> = 0>
static void put(const char* key, T v)
{
    if constexpr (std::is_signed_v<T>)
        line(key, std::to_string(static_cast<long long>(v)));
    else
        line(key, std::to_string(static_cast<unsigned long long>(v)));
}
template <class T> static void put(const char* key, const std::optional<T>& v)
{
    if (! v) return line(key, "null");
    put(key, *v);
}

int main()
{
${lines.join('\n')}
    return 0;
}
`;
    const file = join(dir, 'corpus.cpp');
    const binary = join(dir, 'corpus');
    writeFileSync(file, source);
    const flags = [
      '-std=c++17',
      '-O2',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-fsanitize=undefined,float-cast-overflow',
      '-fsanitize-trap=all',
    ];
    // Where the CPU has FMA, the compiler could fuse; the pragmas must stop it.
    if (arch() === 'x64') flags.push('-mfma');
    const build = spawnSync(compiler, [...flags, file, '-o', binary], {
      encoding: 'utf8',
    });
    expect(build.status, build.stderr).toBe(0);
    const run = spawnSync(binary, { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout.trim().split('\n')).toEqual(expected);
  }, 120_000);

  it('compiles nullable and string types to their C++ types', () => {
    for (const test of corpus) {
      if (!isNullableType(test.expression.type)) continue;
      expect(compileCpp(test.expression, test.inputs)).toBeTypeOf('string');
    }
  });
});

function replacer(_: string, value: unknown) {
  return typeof value === 'bigint' ? `${value}n` : value;
}
