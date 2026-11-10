/**
 * One corpus of expressions and inputs, evaluated by both compilers: the
 * JavaScript results are pinned where a case says what it expects, and the
 * C++ results must equal the JavaScript ones bit for bit.
 */

import type { Expression } from '../ast';
import { createContext, type ExpressionContext } from '../builder';
import type { ExpressionInputs } from '../check';
import type { ExpressionType } from '../types';

export interface Case {
  readonly name: string;
  readonly inputs: ExpressionInputs;
  readonly expression: Expression;
  /** Input values, in the order of `inputs`, and optionally what JavaScript gives. */
  readonly samples: readonly (readonly [readonly unknown[], unknown?])[];
}

function define<const I extends Readonly<Record<string, ExpressionType>>>(
  name: string,
  inputs: I,
  build: (e: ExpressionContext<I>) => Expression,
  samples: Case['samples'],
): Case {
  return { name, inputs, expression: build(createContext(inputs)), samples };
}

const F32_MAX = 3.4028234663852886e38;

export const corpus: readonly Case[] = [
  // ── Integer arithmetic wraps ──
  define('int8 add wraps', { a: 'int8', b: 'int8' }, (e) => e.add(e.a, e.b), [
    [[100, 27], 127],
    [[100, 28], -128],
    [[-128, -1], 127],
  ]),
  define(
    'uint8 sub wraps',
    { a: 'uint8', b: 'uint8' },
    (e) => e.sub(e.a, e.b),
    [
      [[0, 1], 255],
      [[200, 100], 100],
    ],
  ),
  define(
    'uint16 mul wraps',
    { a: 'uint16', b: 'uint16' },
    (e) => e.mul(e.a, e.b),
    [
      [[65535, 65535], 1],
      [[256, 256], 0],
    ],
  ),
  define(
    'int32 mul wraps',
    { a: 'int32', b: 'int32' },
    (e) => e.mul(e.a, e.b),
    [
      [[65536, 65536], 0],
      [[2147483647, 2], -2],
      [[-7, 3], -21],
    ],
  ),
  define(
    'uint32 add wraps',
    { a: 'uint32', b: 'uint32' },
    (e) => e.add(e.a, e.b),
    [
      [[4294967295, 1], 0],
      [[4294967295, 4294967295], 4294967294],
    ],
  ),
  define(
    'int32 div truncates',
    { a: 'int32', b: 'int32' },
    (e) => e.div(e.a, e.b),
    [
      [[7, 2], 3],
      [[-7, 2], -3],
      [[7, 0], 0],
      [[-2147483648, -1], -2147483648],
    ],
  ),
  define(
    'int32 neg and abs wrap',
    { a: 'int32' },
    (e) => e.add(e.neg(e.a), e.abs(e.a)),
    [
      [[-2147483648], 0],
      [[-5], 10],
      [[5], 0],
    ],
  ),
  define(
    'int16 min max',
    { a: 'int16', b: 'int16' },
    (e) => e.sub(e.max(e.a, e.b), e.min(e.a, e.b)),
    [
      [[-3, 9], 12],
      [[9, -3], 12],
    ],
  ),
  define(
    'int64 arithmetic',
    { a: 'int64', b: 'int64' },
    (e) => e.add(e.mul(e.a, e.b), e.div(e.a, e.b)),
    [
      [[9223372036854775807n, 2n], 4611686018427387901n],
      [[-9223372036854775808n, -1n], 0n],
      [[10n, 0n], 0n],
    ],
  ),
  define('uint64 sub wraps', { a: 'uint64' }, (e) => e.sub(e.a, 1n), [
    [[0n], 18446744073709551615n],
    [[5n], 4n],
  ]),
  define(
    'int64 min abs',
    { a: 'int64', b: 'int64' },
    (e) => e.abs(e.min(e.a, e.b)),
    [
      [[-9223372036854775808n, 0n], -9223372036854775808n],
      [[-4n, 3n], 4n],
    ],
  ),

  // ── Floats ──
  define(
    'float32 rounds every operation',
    { a: 'float32', b: 'float32' },
    (e) => e.add(e.mul(e.a, e.b), e.a),
    [
      [
        [0.1, 0.2],
        Math.fround(
          Math.fround(Math.fround(0.1) * Math.fround(0.2)) + Math.fround(0.1),
        ),
      ],
      [[16777216, 1], 33554432],
      [[1.0000001, 1.0000001]],
      [[3.3, 7.7]],
    ],
  ),
  define(
    'float64 fused-looking expression',
    { a: 'float64', b: 'float64', c: 'float64' },
    (e) => e.add(e.mul(e.a, e.b), e.c),
    [
      [[0.1, 10, -1], 0.1 * 10 - 1],
      [[1 + 2 ** -52, 1 - 2 ** -53, -1], (1 + 2 ** -52) * (1 - 2 ** -53) - 1],
    ],
  ),
  define(
    'float32 overflow',
    { a: 'float32' },
    (e) => e.mul(e.a, e.float32(2)),
    [
      [[F32_MAX], Infinity],
      [[-F32_MAX], -Infinity],
    ],
  ),
  define('float division by zero', { a: 'float64' }, (e) => e.div(e.a, 0), [
    [[1], Infinity],
    [[-1], -Infinity],
    [[0], NaN],
  ]),
  define(
    'float min max',
    { a: 'float64', b: 'float64' },
    (e) => e.add(e.min(e.a, e.b), e.max(e.a, e.b)),
    [
      [[1, 2], 3],
      [[NaN, 2], NaN],
      [[2, NaN], NaN],
    ],
  ),
  define(
    'signed zero min',
    { a: 'float64', b: 'float64' },
    (e) => e.div(e.float64(1), e.min(e.a, e.b)),
    [
      [[0, -0], -Infinity],
      [[-0, 0], -Infinity],
    ],
  ),
  define(
    'signed zero max',
    { a: 'float64', b: 'float64' },
    (e) => e.div(e.float64(1), e.max(e.a, e.b)),
    [
      [[0, -0], Infinity],
      [[-0, 0], Infinity],
    ],
  ),
  define('round halves away from zero', { a: 'float64' }, (e) => e.round(e.a), [
    [[2.5], 3],
    [[-2.5], -3],
    [[0.49999999999999994], 0],
    [[-0.3], -0],
    [[1.5], 2],
    [[NaN], NaN],
  ]),
  define(
    'float32 floor ceil',
    { a: 'float32' },
    (e) => e.add(e.floor(e.a), e.ceil(e.a)),
    [
      [[1.5], 3],
      [[-1.5], -3],
    ],
  ),
  define(
    'float32 transcendental',
    { a: 'float32' },
    (e) => e.add(e.sqrt(e.a), e.log(e.exp(e.a))),
    [[[2]], [[0.25]], [[100]]],
  ),
  define(
    'float64 pow special cases',
    { a: 'float64', b: 'float64' },
    (e) => e.pow(e.a, e.b),
    [
      [[1, NaN], NaN],
      [[-1, Infinity], NaN],
      [[NaN, 0], 1],
      [[2, 10], 1024],
      [[1000, 0.5]],
      [[-8, 1 / 3], NaN],
    ],
  ),
  define(
    'float32 pow',
    { a: 'float32', b: 'float32' },
    (e) => e.pow(e.a, e.b),
    [[[20, 0.37]], [[1000, 0.5]]],
  ),

  // ── Conversions ──
  define(
    'float to int saturates',
    { a: 'float64' },
    (e) => e.convert(e.a, 'int8'),
    [
      [[1000], 127],
      [[-1000], -128],
      [[NaN], 0],
      [[-1.9], -1],
      [[127.9], 127],
    ],
  ),
  define('float to uint32', { a: 'float64' }, (e) => e.convert(e.a, 'uint32'), [
    [[-0.5], 0],
    [[4294967295.5], 4294967295],
    [[4294967296], 4294967295],
    [[1e300], 4294967295],
  ]),
  define('float to int64', { a: 'float64' }, (e) => e.convert(e.a, 'int64'), [
    [[9.3e18], 9223372036854775807n],
    [[-9.3e18], -9223372036854775808n],
    [[-9223372036854775808], -9223372036854775808n],
    [[123456789012.9], 123456789012n],
    [[NaN], 0n],
  ]),
  define('float to uint64', { a: 'float64' }, (e) => e.convert(e.a, 'uint64'), [
    [[2e19], 18446744073709551615n],
    [[-1], 0n],
    [[1e19], 10000000000000000000n],
  ]),
  define(
    'int wraps to narrower',
    { a: 'int32' },
    (e) => e.convert(e.a, 'uint8'),
    [
      [[300], 44],
      [[-1], 255],
    ],
  ),
  define('int64 to int16', { a: 'int64' }, (e) => e.convert(e.a, 'int16'), [
    [[65537n], 1],
    [[-32769n], 32767],
  ]),
  define('int32 to int64', { a: 'int32' }, (e) => e.convert(e.a, 'int64'), [
    [[-5], -5n],
  ]),
  define('uint32 to uint64', { a: 'uint32' }, (e) => e.convert(e.a, 'uint64'), [
    [[4294967295], 4294967295n],
  ]),
  define('int64 to float32', { a: 'int64' }, (e) => e.convert(e.a, 'float32'), [
    [[9007199254740993n]],
    [[16777217n], 16777216],
  ]),
  define(
    'float64 to float32',
    { a: 'float64' },
    (e) => e.convert(e.a, 'float32'),
    [
      [[0.1], Math.fround(0.1)],
      [[3.4028235677973366e38], Infinity],
      [[3.4028235677973362e38], F32_MAX],
    ],
  ),

  // ── Comparison, logic, conditionals ──
  define(
    'comparisons',
    { a: 'float32', b: 'float32' },
    (e) =>
      e.if(
        e.and(e.lte(e.a, e.b), e.ne(e.a, e.b)),
        'less',
        e.if(e.eq(e.a, e.b), 'equal', 'more'),
      ),
    [
      [[1, 2], 'less'],
      [[2, 2], 'equal'],
      [[0, -0], 'equal'],
      [[3, 2], 'more'],
      [[NaN, 1], 'more'],
    ],
  ),
  define(
    'boolean logic',
    { a: 'boolean', b: 'boolean' },
    (e) => e.or(e.not(e.a), e.and(e.a, e.b)),
    [
      [[true, false], false],
      [[false, false], true],
      [[true, true], true],
    ],
  ),
  define(
    'string equality',
    { s: 'string' },
    (e) => e.eq(e.lower(e.trim(e.s)), 'low pass'),
    [
      [['  Low Pass\t'], true],
      [['lowpass'], false],
    ],
  ),

  // ── Text ──
  define('fixed', { a: 'float64' }, (e) => e.fixed(e.a, 2), [
    [[1.005], '1.00'],
    [[0.125], '0.13'],
    [[-0.125], '-0.13'],
    [[-0.001], '0.00'],
    [[-0], '0.00'],
    [[1234.5678], '1234.57'],
    [[0.5], '0.50'],
    [[1e20], '100000000000000000000.00'],
    [[1e300]],
    [[NaN], 'NaN'],
    [[-Infinity], '-Infinity'],
  ]),
  define(
    'fixed float32 no decimals',
    { a: 'float32' },
    (e) => e.fixed(e.a, 0),
    [
      [[0.5], '1'],
      [[-0.5], '-1'],
      [[2.4999998], '2'],
      [[16777216], '16777216'],
    ],
  ),
  define(
    'fixed integers',
    { a: 'int16', b: 'uint64' },
    (e) => e.concat(e.fixed(e.a, 1), ' ', e.fixed(e.b, 0)),
    [[[-12, 18446744073709551615n], '-12.0 18446744073709551615']],
  ),
  define(
    'concat removeSuffix endsWith',
    { s: 'string' },
    (e) =>
      e.if(
        e.endsWith(e.s, 'Hz'),
        e.concat('[', e.removeSuffix(e.s, 'Hz'), ']'),
        e.concat('<', e.s, '>'),
      ),
    [
      [['500 Hz'], '[500 ]'],
      [['Hz'], '[]'],
      [['500'], '<500>'],
      [['élan “quoted” \\ ?'], '<élan “quoted” \\ ?>'],
    ],
  ),

  // ── Parsing ──
  define(
    'parse float64',
    { s: 'string' },
    (e) => e.coalesce(e.parseFloat64(e.s), e.float64(-999)),
    [
      [['1.25'], 1.25],
      [['  -3.50 '], -3.5],
      [['+.5'], 0.5],
      [['5.'], 5],
      [['1e3'], 1000],
      [['1E-3'], 0.001],
      [['0.1'], 0.1],
      [['123456789012345678901234567890']],
      [['0.000000000000000000000000000001']],
      [['1e400'], -999],
      [['1e-400'], 0],
      [['.'], -999],
      [['1.2.3'], -999],
      [['0x10'], -999],
      [['Infinity'], -999],
      [['NaN'], -999],
      [[''], -999],
      [['1e'], -999],
      [['1,5'], -999],
      [['1e00000000000000000000003'], 1000],
      [['00012.5000'], 12.5],
      [['1.7976931348623157e308']],
    ],
  ),
  define(
    'parse negative zero',
    { s: 'string' },
    (e) => e.div(e.float64(1), e.coalesce(e.parseFloat64(e.s), e.float64(1))),
    [
      [['-0'], -Infinity],
      [['0'], Infinity],
    ],
  ),
  define(
    'parse float32',
    { s: 'string' },
    (e) => e.coalesce(e.parseFloat32(e.s), e.float32(-999)),
    [
      [['0.1'], Math.fround(0.1)],
      [['3.4028235e38'], F32_MAX],
      [['3.5e38'], -999],
      [['16777217'], 16777216],
    ],
  ),
  define(
    'parse int8',
    { s: 'string' },
    (e) => e.coalesce(e.parseInt8(e.s), -1),
    [
      [['127'], 127],
      [['-128'], -128],
      [['128'], -1],
      [['1.5'], -1],
      [[' +7 '], 7],
      [['-0'], 0],
    ],
  ),
  define(
    'parse uint32',
    { s: 'string' },
    (e) => e.coalesce(e.parseUint32(e.s), 7),
    [
      [['4294967295'], 4294967295],
      [['4294967296'], 7],
      [['-1'], 7],
      [['-0'], 0],
      [['99999999999999999999999'], 7],
    ],
  ),
  define(
    'parse int64',
    { s: 'string' },
    (e) => e.coalesce(e.parseInt64(e.s), 1n),
    [
      [['-9223372036854775808'], -9223372036854775808n],
      [['9223372036854775808'], 1n],
    ],
  ),
  define(
    'parse uint64',
    { s: 'string' },
    (e) => e.coalesce(e.parseUint64(e.s), 1n),
    [
      [['18446744073709551615'], 18446744073709551615n],
      [['18446744073709551616'], 1n],
    ],
  ),
  define(
    'isNull and map',
    { s: 'string' },
    (e) =>
      e.if(
        e.isNull(e.parseFloat32(e.s)),
        e.float32(-1),
        e.coalesce(
          e.map(e.parseFloat32(e.s), (v) => e.mul(v, 2)),
          0,
        ),
      ),
    [
      [['2.5'], 5],
      [['x'], -1],
    ],
  ),
  define(
    'nested map',
    { a: 'string', b: 'string' },
    (e) =>
      e.map(e.parseInt32(e.a), (x) =>
        e.map(e.parseInt32(e.b), (y) => e.add(x, y)),
      ),
    [
      [['2', '3'], 5],
      [['2', 'x'], null],
      [['x', '3'], null],
    ],
  ),
  define(
    'if joins nullable',
    { a: 'boolean' },
    (e) => e.if(e.a, e.float64(1), e.null('float64')),
    [
      [[true], 1],
      [[false], null],
    ],
  ),

  // ── What plugins format and parse ──
  define(
    'frequency format',
    { value: 'float32' },
    (e) =>
      e.if(
        e.gte(e.value, 1000),
        e.concat(e.fixed(e.div(e.value, 1000), 2), ' kHz'),
        e.concat(e.fixed(e.value, 0), ' Hz'),
      ),
    [
      [[1250], '1.25 kHz'],
      [[999.4], '999 Hz'],
      [[20000], '20.00 kHz'],
      [[20], '20 Hz'],
    ],
  ),
  define(
    'frequency parse',
    { text: 'string' },
    (e) => {
      const text = e.lower(e.trim(e.text));
      return e.if(
        e.endsWith(text, 'khz'),
        e.map(e.parseFloat32(e.removeSuffix(text, 'khz')), (v) =>
          e.mul(v, 1000),
        ),
        e.parseFloat32(e.removeSuffix(text, 'hz')),
      );
    },
    [
      [['1.25 kHz'], 1250],
      [['500 Hz'], 500],
      [['500'], 500],
      [['20KHZ'], 20000],
      [['kHz'], null],
      [['invalid'], null],
    ],
  ),
  define(
    'decibels format',
    { value: 'float32' },
    (e) => e.concat(e.fixed(e.value, 2), ' dB'),
    [
      [[-3.5], '-3.50 dB'],
      [[0], '0.00 dB'],
      [[-0.004], '0.00 dB'],
    ],
  ),
  define(
    'percent',
    { value: 'float32' },
    (e) => e.concat(e.fixed(e.mul(e.value, 100), 0), '%'),
    [[[0.75], '75%']],
  ),
];
