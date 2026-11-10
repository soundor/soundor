---
title: 'Expression language'
description: '@soundor/expression: the typed, portable expressions parameters are defined with, their exact semantics, and the C++ and JavaScript compilers.'
---

Source: [`packages/expression/`](https://github.com/soundor/soundor/tree/main/packages/expression).

A parameter's behavior must be the same in a DAW with the editor closed, in
the browser and in tests: the same value at a knob's position, the same text,
the same reading of typed text. Soundor does not run a JavaScript function in
the host for that, nor write the behavior once per runtime. A config writes it
as an **expression**: a typed tree of a small, pure language, which
`@soundor/expression` checks and compiles to C++ and to JavaScript with the
same semantics, operation for operation.

```text
soundor.config.ts ─ resolveParameters ─▶ ParameterSemantics (expression trees)
                                           │
                     ┌─────────────────────┼──────────────────────┐
                     ▼                     ▼                      ▼
               compileCpp             compileJs              compileJsFunction
          SoundorParameters.cpp   parameters.js (Web)    the test runtime
              (JUCE runtime)
```

## How parameters use it

`@soundor/config`'s `resolveParameters` turns every declaration into a
`ResolvedParameter`, whose `semantics` holds five expressions over the
parameter's `valueType` (its numeric type; `uint8` for a boolean's 0 and 1,
`uint32` for a choice's option index):

| Expression     | Inputs                | Result                                                      |
| -------------- | --------------------- | ----------------------------------------------------------- |
| `toValue`      | `normalized: float64` | the value at a position: clamped to [0, 1], mapped, snapped |
| `toNormalized` | `value`               | a legal value's position in [0, 1], as float64              |
| `constrain`    | `value: float64`      | the nearest legal value: clamped and snapped                |
| `format`       | `value`               | the display text; cannot fail                               |
| `parse`        | `text: string`        | a legal value, or null                                      |

The built-in mappings, step snapping, default formatting and number parsing
are written in the language too (`packages/config/src/parameter-model.ts`), so
a runtime has nothing to implement but compiling five expressions: it never
knows what a `'log'` mapping is. A config's own `format`, `parse` and custom
mapping are substituted into these (`substituteInputs`), and validation
evaluates the result through the JavaScript compiler: endpoints, monotonicity
and inversion of a custom mapping, and that `parse` reads back what `format`
writes, at sample values.

Runtimes reach the package through `@soundor/runtime-sdk/expression`,
`/expression/cpp` and `/expression/js`, so a third-party runtime depends on
the SDK alone.

## The language

An `Expression<T>` is a plain, frozen, JSON-serializable object whose `type`
is its result type, so TypeScript tells an `int32` expression from a `float32`
one. 64-bit integer literals are stored as decimal strings. There are no
loops, assignments or calls: an expression is a pure function of its inputs.
`let` names a value used more than once, and `map` the value of a nullable.

Types: `int8`, `uint8`, `int16`, `uint16`, `int32`, `uint32`, `int64`,
`uint64`, `float32`, `float64`, `boolean`, `string`, and a nullable of each
numeric type (`float32?`), which parsing gives. Parameters use the types up to
32 bits; the compilers support all of them.

The builder (`createContext(inputs)`, or the `e` a config's functions
receive) types every operation. Operands of one operation have one type, and
a plain number next to an expression takes its type (`e.mul(e.value, 1000)`).

| Group      | Operations                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Arithmetic | `add`, `sub`, `mul`, `div`, `min`, `max`, `neg`, `abs`; on floats `pow`, `sqrt`, `exp`, `log`, `floor`, `ceil`, `round`              |
| Conversion | `convert(a, type)`                                                                                                                   |
| Comparison | `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `and`, `or`, `not`, `if`                                                                       |
| Text       | `fixed(a, digits)`, `concat`, `trim`, `lower`, `endsWith`, `removeSuffix`, `parse(text, type)` (and `parseFloat32`, `parseInt32`, …) |
| Nullables  | `isNull`, `coalesce(a, fallback)`, `map(a, body)`                                                                                    |
| Binding    | `let(value, body)`                                                                                                                   |

### Semantics

What both compilers implement, and the differential test checks:

- **Integers wrap** (two's complement) on overflow. Division truncates toward
  zero; an integer divided by zero is 0.
- **`float32` is rounded to binary32 after every operation**, as
  `Math.fround` does; `float64` is IEEE double.
- **No contraction**: a multiplication and an addition are never fused into
  an FMA (JavaScript never does). The C++ output starts with pragmas that turn
  contraction off (`CPP_PRAGMAS`); code built with `-ffast-math` does not have
  these semantics.
- `round` rounds halves away from zero (2.5 → 3, -2.5 → -3).
- `min` and `max` are JavaScript's: NaN if either operand is, and -0 below +0.
- `pow` has JavaScript's special cases (`pow(x, NaN)` is NaN, `pow(1, ∞)` is
  NaN), which differ from C's.
- `convert` to an integer truncates toward zero and saturates at the type's
  bounds, NaN becoming 0; between integers it wraps; to a float it rounds to
  nearest.
- `fixed(a, digits)` (0 to 15 digits) scales, rounds half away from zero and
  prints the digits; it never prints a negative zero (`-0.00` is `0.00`).
- `parse` reads decimal notation (`-12`, `0.5`, `1e3`; integers without a
  fraction or exponent), with surrounding ASCII whitespace ignored, by one
  deterministic algorithm written in each language rather than the platform's
  `strtod` or `Number()`. An integer outside its type, or a float outside its
  finite range, is null.
- `trim` and `lower` are ASCII-only, independent of locale.

`checkExpression` (and `assertExpression`, which throws `ExpressionError`)
checks a tree before anything compiles it: node shapes, types, bound
variables, at most 128 levels of nesting and 10,000 nodes.

## Compilers

- `compileJs(expression, inputs)` gives a JavaScript expression over the small
  runtime `JS_RUNTIME` declares (`const $x`); a generated module emits the
  runtime once. `compileJsFunction` evaluates it into a function, for
  validation and the test runtime.
- `compileCpp(expression, inputs)` gives a C++17 expression over the helpers
  `cppRuntime()` emits into `namespace soundor_expression`, after
  `CPP_PRAGMAS` and `CPP_INCLUDES`. It is plain standard C++, without a
  framework, exceptions or allocation (except for strings), so any C++ plugin
  framework could reuse it. `cppType` names an expression type's C++ type.

## Tests and tolerances

`src/__tests__/corpus.ts` is a corpus of expressions and inputs at the
edges: overflow, signed zeros, NaN, infinities, halves, subnormals, long
and malformed text. `compiler.test.ts` evaluates it in JavaScript, and, where
a compiler is installed, compiles it to C++ with Clang and GCC (strict
warnings, `-fsanitize=undefined,float-cast-overflow` trapping, and `-mfma` on
x64, so a contraction would show), then requires **the same bits** for every
result. Inputs reach the C++ through an opaque function, so the optimizer
cannot fold them at compile time: built without the pragmas and with
`-mfma`, the test fails, which is how to check a change to them.

The one thing that may differ is the last bit of `exp`, `log` and `pow`:
V8's and the C library's are both correctly rounded nearly always, but not
always the same. The corpus avoids those cases; the JUCE runtime's parity
test (`runtimes/juce-runtime/native/backend/juce/tests`), which runs the
generated C++ against values the JavaScript computed
(`ParameterParity.h`), allows a last-bit difference for normalized positions
and a float's ulp for values, and requires at least 99% of them to be exact.
Formatted and parsed results must match exactly.

Adding an operation means adding it to the AST, the checker, the builder,
both compilers and the corpus, in one change.
