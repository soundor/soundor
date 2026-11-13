// Plugin code calling soundor:native, which the runtime's Vite plugin makes
// from the manifest, into an implementation typed by the generated contract.
// The messages are the JUCE runtime's, word for word (the engine's
// tests/native/NativeModuleTests.cpp checks the same calls).

import * as native from 'soundor:native';
import { beforeEach, describe, expect, it } from 'vitest';

import { installNative } from './native';
import type {
  Buffers,
  Numbers,
  Optionals,
  WebNativeApi,
} from './testing/native';

/** What the implementation last received, by method. */
const received: Record<string, unknown[]> = {};
let soloSlot: number | null = null;
const pending: ((value: unknown) => void)[] = [];

/** The project's runtimes/web/src/native.ts, for the fixture plugin. */
const implementation: WebNativeApi = {
  add: (a, b) => a + b,
  analyze(samples) {
    const rms = Math.sqrt(
      samples.reduce((sum, x) => sum + x * x, 0) / samples.length,
    );
    return { rms, peaks: [Math.max(...samples)] };
  },
  scale: (values, factor) => values.map((value) => value * factor),
  invert: (on) => !on,
  echo(data) {
    received['echo'] = [data];
    return data;
  },
  echoUint8: (value) => value,
  echoInt64: (value) => value,
  echoUint64: (value) => value,
  echoFloat32: (value) => value,
  echoNumbers(numbers) {
    received['echoNumbers'] = [numbers];
    return numbers;
  },
  echoBuffers(buffers) {
    received['echoBuffers'] = [buffers];
    return buffers;
  },
  echoOptionals: (optionals) => optionals,
  firstPoint: (points) => points?.[0] ?? null,
  sumWords: (values) => values && values.reduce((sum, x) => sum + x, 0n),
  setCurve(curve) {
    if (curve !== 'linear') throw new RangeError(`no ${curve} curve here`);
  },
  setSolo(slot) {
    soloSlot = slot;
  },
  solo: () => soloSlot,
  loadPreset(path) {
    if (path === 'missing') return Promise.resolve(null);
    if (path === 'later')
      return new Promise((resolve) => pending.push(resolve as never));
    return Promise.resolve({ name: path, gains: [0.5, 1] });
  },
  applyPreset(preset) {
    received['applyPreset'] = [preset];
  },
  fail() {
    throw new Error('disk full');
  },
  failLater: () => Promise.reject(new Error('later')),
};

const numbers = (overrides: Partial<Numbers> = {}): Numbers => ({
  i8: 0,
  u8: 0,
  i16: 0,
  u16: 0,
  i32: 0,
  u32: 0,
  i64: 0n,
  u64: 0n,
  f32: 0,
  f64: 0,
  ...overrides,
});

const buffers = (overrides: Partial<Buffers> = {}): Buffers => ({
  i8: new Int8Array(0),
  u8: new Uint8Array(0),
  i16: new Int16Array(0),
  u16: new Uint16Array(0),
  i32: new Int32Array(0),
  u32: new Uint32Array(0),
  i64: new BigInt64Array(0),
  u64: new BigUint64Array(0),
  f32: new Float32Array(0),
  f64: new Float64Array(0),
  ...overrides,
});

const optionals = (overrides: Partial<Optionals> = {}): Optionals => ({
  slot: null,
  id: null,
  name: null,
  curve: null,
  point: null,
  gains: null,
  samples: null,
  ...overrides,
});

/** The error `call` throws, as `Name: message`. */
function error(call: () => unknown): string {
  try {
    call();
  } catch (thrown) {
    const e = thrown as Error;
    return `${e.name}: ${e.message}`;
  }
  throw new Error('expected the call to throw');
}

/** Calls with values the declaration does not allow. */
const untyped = native as unknown as Record<
  string,
  (...args: unknown[]) => unknown
>;

describe('soundor:native', () => {
  it('exports every declared method', () => {
    expect(Object.keys(native).sort()).toEqual([
      'add',
      'analyze',
      'applyPreset',
      'channels',
      'echo',
      'echoBuffers',
      'echoFloat32',
      'echoInt64',
      'echoNumbers',
      'echoOptionals',
      'echoUint64',
      'echoUint8',
      'events',
      'fail',
      'failLater',
      'firstPoint',
      'invert',
      'loadPreset',
      'scale',
      'setCurve',
      'setSolo',
      'solo',
      'sumWords',
    ]);
    expect(native.analyze.name).toBe('analyze');
    expect(native.add.length).toBe(2);
  });

  it('says what is missing before an implementation is installed', async () => {
    expect(() => native.invert(true)).toThrow(
      /invert\(\) has no Web implementation\. Implement it in runtimes\/web\/src\/native\.ts/,
    );
    await expect(native.failLater()).rejects.toThrow(
      /failLater\(\) has no Web implementation/,
    );
  });

  it('rejects an implementation that misses methods', () => {
    expect(() => installNative({ native: { invert: () => true } })).toThrow(
      /^runtimes\/web\/src\/native\.ts does not implement add\(\), analyze\(\), applyPreset\(\), echo\(\),/,
    );
    expect(() => installNative({})).toThrow(
      "runtimes/web/src/native.ts must export the native API implementation as 'native'",
    );
  });

  describe('with an implementation', () => {
    beforeEach(() => {
      installNative({ native: implementation });
    });

    it('passes values both ways', () => {
      const samples = new Float32Array([0.5, -0.5, 1, -1]);
      expect(native.analyze(samples)).toEqual({
        rms: Math.fround(Math.sqrt(0.625)),
        peaks: [1],
      });
      expect(native.add(40, 2)).toBe(42);
      expect(native.scale([1, 2], 3)).toEqual([3, 6]);
      expect(native.invert(false)).toBe(true);
      expect(native.setCurve('linear')).toBeUndefined();
    });

    it('validates arguments with the native messages', () => {
      expect(error(() => untyped['add']!(1, '2'))).toBe(
        'TypeError: add(): b: expected int32, got string',
      );
      expect(error(() => untyped['add']!(1))).toBe(
        'TypeError: add() expects 2 arguments, got 1',
      );
      expect(untyped['add']!(1, 2, 'ignored')).toBe(3);
      expect(error(() => untyped['analyze']!(new Float64Array(2)))).toBe(
        'TypeError: analyze(): samples: expected Float32Array, got typed array',
      );
      expect(error(() => untyped['analyze']!([1, 2]))).toBe(
        'TypeError: analyze(): samples: expected Float32Array, got array',
      );
      expect(error(() => untyped['setCurve']!('cubic'))).toBe(
        "TypeError: setCurve(): curve: expected one of 'linear', 'exponential', got 'cubic'",
      );
      expect(error(() => untyped['setCurve']!(1))).toBe(
        "TypeError: setCurve(): curve: expected one of 'linear', 'exponential', got number",
      );
      expect(
        error(() => untyped['firstPoint']!([{ x: 1, y: 2 }, { x: 1 }])),
      ).toBe(
        'TypeError: firstPoint(): points[1].y: expected float64, got undefined',
      );
      expect(error(() => untyped['firstPoint']!({}))).toBe(
        'TypeError: firstPoint(): points: expected array, got object',
      );
      expect(error(() => untyped['scale']!(['a'], 1))).toBe(
        'TypeError: scale(): values[0]: expected float64, got string',
      );
    });

    it('integers of up to 32 bits: every boundary, nothing coerced', () => {
      expect(
        native.echoNumbers(
          numbers({
            i8: -128,
            u8: 255,
            i16: -32768,
            u16: 65535,
            i32: -2147483648,
            u32: 4294967295,
          }),
        ),
      ).toEqual(
        numbers({
          i8: -128,
          u8: 255,
          i16: -32768,
          u16: 65535,
          i32: -2147483648,
          u32: 4294967295,
        }),
      );
      expect(
        native.echoNumbers(numbers({ i8: 127, i16: 32767, i32: 2147483647 })),
      ).toEqual(numbers({ i8: 127, i16: 32767, i32: 2147483647 }));
      expect(Object.is(native.echoUint8(-0), 0)).toBe(true);

      const outOfRange: [keyof Numbers, number, string, string][] = [
        ['i8', -129, 'int8', '-128 to 127'],
        ['i8', 128, 'int8', '-128 to 127'],
        ['u8', -1, 'uint8', '0 to 255'],
        ['u8', 256, 'uint8', '0 to 255'],
        ['i16', -32769, 'int16', '-32768 to 32767'],
        ['i16', 32768, 'int16', '-32768 to 32767'],
        ['u16', -1, 'uint16', '0 to 65535'],
        ['u16', 65536, 'uint16', '0 to 65535'],
        ['i32', -2147483649, 'int32', '-2147483648 to 2147483647'],
        ['i32', 2147483648, 'int32', '-2147483648 to 2147483647'],
        ['u32', -1, 'uint32', '0 to 4294967295'],
        ['u32', 4294967296, 'uint32', '0 to 4294967295'],
      ];
      for (const [key, value, type, range] of outOfRange) {
        expect(error(() => native.echoNumbers(numbers({ [key]: value })))).toBe(
          `RangeError: echoNumbers(): numbers.${key}: ${value} is out of range for ${type} (${range})`,
        );
      }

      expect(error(() => native.echoUint8(1.5))).toBe(
        'TypeError: echoUint8(): value: expected an integer (uint8), got 1.5',
      );
      expect(error(() => native.echoUint8(NaN))).toBe(
        'TypeError: echoUint8(): value: expected an integer (uint8), got NaN',
      );
      expect(error(() => native.add(Infinity, 1))).toBe(
        'TypeError: add(): a: expected an integer (int32), got Infinity',
      );
      expect(error(() => untyped['echoUint8']!('1'))).toBe(
        'TypeError: echoUint8(): value: expected uint8, got string',
      );
      expect(error(() => untyped['echoUint8']!(1n))).toBe(
        'TypeError: echoUint8(): value: expected uint8, got bigint',
      );
      expect(error(() => untyped['echoUint8']!(new Number(1)))).toBe(
        'TypeError: echoUint8(): value: expected uint8, got object',
      );
    });

    it('64-bit integers are bigints over their whole range', () => {
      expect(native.echoInt64(-(2n ** 63n))).toBe(-(2n ** 63n));
      expect(native.echoInt64(2n ** 63n - 1n)).toBe(2n ** 63n - 1n);
      expect(native.echoUint64(2n ** 64n - 1n)).toBe(2n ** 64n - 1n);
      expect(native.echoUint64(2n ** 53n + 1n)).toBe(2n ** 53n + 1n);
      expect(
        native.echoNumbers(numbers({ i64: -(2n ** 63n), u64: 2n ** 64n - 1n })),
      ).toEqual(numbers({ i64: -(2n ** 63n), u64: 2n ** 64n - 1n }));

      expect(error(() => native.echoInt64(2n ** 63n))).toBe(
        'RangeError: echoInt64(): value: 9223372036854775808 is out of range for int64 (-9223372036854775808 to 9223372036854775807)',
      );
      expect(error(() => native.echoInt64(-(2n ** 63n) - 1n))).toBe(
        'RangeError: echoInt64(): value: -9223372036854775809 is out of range for int64 (-9223372036854775808 to 9223372036854775807)',
      );
      expect(error(() => native.echoUint64(-1n))).toBe(
        'RangeError: echoUint64(): value: -1 is out of range for uint64 (0 to 18446744073709551615)',
      );
      expect(error(() => native.echoUint64(2n ** 64n))).toBe(
        'RangeError: echoUint64(): value: 18446744073709551616 is out of range for uint64 (0 to 18446744073709551615)',
      );
      expect(error(() => untyped['echoInt64']!(1))).toBe(
        'TypeError: echoInt64(): value: expected int64, got number',
      );
      expect(error(() => untyped['echoUint64']!('1'))).toBe(
        'TypeError: echoUint64(): value: expected uint64, got string',
      );
    });

    it('floats keep their precision', () => {
      for (const x of [0.1, 1 / 3, 16777217, 1e-46, -1.5e-45, 3.4028235e38]) {
        expect(Object.is(native.echoFloat32(x), Math.fround(x))).toBe(true);
      }
      expect(native.echoFloat32(0.1)).not.toBe(0.1);
      expect(Object.is(native.echoFloat32(-0), -0)).toBe(true);
      expect(native.echoFloat32(NaN)).toBeNaN();
      expect(native.echoFloat32(-Infinity)).toBe(-Infinity);
      expect(error(() => native.echoFloat32(3.4028235677973366e38))).toBe(
        'RangeError: echoFloat32(): value: 3.4028235677973366e+38 is out of range for float32',
      );
      expect(error(() => native.echoFloat32(-1e300))).toBe(
        'RangeError: echoFloat32(): value: -1e+300 is out of range for float32',
      );
      expect(error(() => untyped['echoFloat32']!(1n))).toBe(
        'TypeError: echoFloat32(): value: expected float32, got bigint',
      );
      const v = native.echoNumbers(numbers({ f64: 0.1 + 0.2, f32: 0.1 }));
      expect(v.f64).toBe(0.1 + 0.2);
      expect(v.f32).toBe(Math.fround(0.1));
      // The implementation receives the float the native side would.
      expect((received['echoNumbers']![0] as Numbers).f32).toBe(
        Math.fround(0.1),
      );
      expect(native.echoNumbers(numbers({ f64: Number.MIN_VALUE })).f64).toBe(
        Number.MIN_VALUE,
      );
      expect(
        error(() => native.echoNumbers(numbers({ f64: '1' as never }))),
      ).toBe(
        'TypeError: echoNumbers(): numbers.f64: expected float64, got string',
      );
    });

    it('nullable values take null, never undefined', () => {
      native.setSolo(null);
      expect(native.solo()).toBeNull();
      native.setSolo(3);
      expect(native.solo()).toBe(3);
      expect(error(() => untyped['setSolo']!(undefined))).toBe(
        'TypeError: setSolo(): slot: expected int32, got undefined',
      );
      expect(error(() => untyped['setSolo']!())).toBe(
        'TypeError: setSolo() expects 1 argument, got 0',
      );
      expect(error(() => native.setSolo(1.5))).toBe(
        'TypeError: setSolo(): slot: expected an integer (int32), got 1.5',
      );
      expect(error(() => untyped['add']!(null, 1))).toBe(
        'TypeError: add(): a: expected int32, got null',
      );

      expect(native.echoOptionals(optionals())).toEqual(optionals());
      const full: Optionals = {
        slot: -1,
        id: 2n ** 64n - 1n,
        name: '',
        curve: 'exponential',
        point: { x: 1, y: 2 },
        gains: [],
        samples: new Float32Array([0.5]),
      };
      expect(native.echoOptionals(full)).toEqual(full);
      expect(
        error(() =>
          native.echoOptionals(optionals({ point: undefined as never })),
        ),
      ).toBe(
        'TypeError: echoOptionals(): optionals.point: expected object, got undefined',
      );
      const missing: Partial<Optionals> = optionals();
      delete missing.name;
      expect(error(() => native.echoOptionals(missing as Optionals))).toBe(
        'TypeError: echoOptionals(): optionals.name: expected string, got undefined',
      );
      expect(
        error(() => native.echoNumbers(numbers({ i8: null as never }))),
      ).toBe('TypeError: echoNumbers(): numbers.i8: expected int8, got null');

      expect(native.firstPoint(null)).toBeNull();
      expect(native.firstPoint([])).toBeNull();
      expect(
        native.firstPoint([
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ]),
      ).toEqual({
        x: 1,
        y: 2,
      });
      expect(native.sumWords(null)).toBeNull();
      expect(native.sumWords(new BigUint64Array([1n, 2n ** 63n]))).toBe(
        2n ** 63n + 1n,
      );
      expect(native.sumWords(new BigUint64Array(0))).toBe(0n);
      expect(error(() => untyped['sumWords']!([1n]))).toBe(
        'TypeError: sumWords(): values: expected BigUint64Array, got array',
      );
    });

    it('copies structs and arrays: only the declared fields cross', () => {
      const preset = { name: 'warm', gains: [0.1, 2], extra: true };
      native.applyPreset(preset);
      const [applied] = received['applyPreset'] as [Record<string, unknown>];
      expect(applied).toEqual({ name: 'warm', gains: [Math.fround(0.1), 2] });
      expect(applied).not.toBe(preset);
      expect(applied['gains']).not.toBe(preset.gains);
      expect(
        error(() =>
          native.applyPreset({
            name: 'warm',
            gains: new Float32Array(1) as never,
          }),
        ),
      ).toBe(
        'TypeError: applyPreset(): preset.gains: expected array, got typed array',
      );
      expect(
        error(() =>
          native.applyPreset({ name: 'warm', gains: [1, 'loud' as never] }),
        ),
      ).toBe(
        'TypeError: applyPreset(): preset.gains[1]: expected float32, got string',
      );
      expect(error(() => untyped['firstPoint']!([1]))).toBe(
        'TypeError: firstPoint(): points[0]: expected object, got number',
      );
    });

    it('buffers of every numeric type', () => {
      const values = buffers({
        i8: new Int8Array([-128, 127]),
        u8: new Uint8Array([0, 255]),
        i16: new Int16Array([-32768, 32767]),
        u16: new Uint16Array([0, 65535]),
        i32: new Int32Array([-2147483648, 2147483647]),
        u32: new Uint32Array([0, 4294967295]),
        i64: new BigInt64Array([-(2n ** 63n), 2n ** 63n - 1n]),
        u64: new BigUint64Array([0n, 2n ** 64n - 1n]),
        f32: new Float32Array([0.1, -Infinity]),
        f64: new Float64Array([0.1, Number.MAX_VALUE]),
      });
      const output = native.echoBuffers(values);
      expect(output).toEqual(values);
      for (const key of Object.keys(values) as (keyof Buffers)[]) {
        expect(output[key].constructor).toBe(values[key].constructor);
        // A copy of its own, in a buffer of exactly its elements.
        expect(output[key].buffer).not.toBe(values[key].buffer);
        expect(output[key].buffer.byteLength).toBe(values[key].byteLength);
      }
      expect(native.echoBuffers(buffers())).toEqual(buffers());

      // A struct field is copied: changing the argument afterwards changes nothing.
      const input = buffers({ f64: new Float64Array([1, 2]) });
      const copied = native.echoBuffers(input);
      input.f64[0] = 9;
      expect([...copied.f64]).toEqual([1, 2]);

      expect(
        error(() =>
          native.echoBuffers(buffers({ i16: new Uint16Array(1) as never })),
        ),
      ).toBe(
        'TypeError: echoBuffers(): buffers.i16: expected Int16Array, got typed array',
      );
      expect(
        error(() =>
          native.echoBuffers(
            buffers({ u8: new Uint8ClampedArray(1) as never }),
          ),
        ),
      ).toBe(
        'TypeError: echoBuffers(): buffers.u8: expected Uint8Array, got typed array',
      );
      expect(
        error(() =>
          native.echoBuffers(buffers({ u8: new ArrayBuffer(1) as never })),
        ),
      ).toBe(
        'TypeError: echoBuffers(): buffers.u8: expected Uint8Array, got ArrayBuffer',
      );
      expect(
        error(() => native.echoBuffers(buffers({ i64: [1n] as never }))),
      ).toBe(
        'TypeError: echoBuffers(): buffers.i64: expected BigInt64Array, got array',
      );
      // A Float32Array subclass is still one; an object claiming to be one is not.
      class Samples extends Float32Array {}
      expect(native.analyze(new Samples([1])).peaks).toEqual([1]);
      expect(
        error(() =>
          untyped['analyze']!({
            [Symbol.toStringTag]: 'Float32Array',
            length: 0,
          }),
        ),
      ).toBe(
        'TypeError: analyze(): samples: expected Float32Array, got object',
      );
    });

    it('lends buffer arguments, and returns buffers of their own', () => {
      const bytes = new Uint8Array([1, 2, 3]);
      const echoed = native.echo(bytes);
      // The implementation reads the caller's own array, as native code
      // borrows it; what comes back is a copy.
      expect(received['echo']![0]).toBe(bytes);
      expect(echoed).toEqual(bytes);
      expect(echoed).not.toBe(bytes);
      const view = new Uint8Array([9, 1, 2, 9]).subarray(1, 3);
      expect(native.echo(view).buffer.byteLength).toBe(2);
      const detached = new Uint8Array(2);
      (detached.buffer as ArrayBuffer & { transfer(): ArrayBuffer }).transfer();
      expect(error(() => native.echo(detached))).toBe(
        'TypeError: ArrayBuffer is detached',
      );
    });

    it('checks what the implementation returns', async () => {
      installNative({
        native: {
          ...implementation,
          add: () => 1.5,
          solo: () => undefined as never,
          echoInt64: () => 1 as never,
          loadPreset: async () => ({ name: 1 }) as never,
        },
      });
      expect(error(() => native.add(1, 2))).toBe(
        'TypeError: add(): result: expected an integer (int32), got 1.5',
      );
      expect(error(() => native.solo())).toBe(
        'TypeError: solo(): result: expected int32, got undefined',
      );
      expect(error(() => native.echoInt64(1n))).toBe(
        'TypeError: echoInt64(): result: expected int64, got number',
      );
      await expect(native.loadPreset('x')).rejects.toThrow(
        new TypeError('loadPreset(): result.name: expected string, got number'),
      );
    });

    it('keeps exceptions as errors and promises as promises', async () => {
      expect(() => native.fail()).toThrow(new Error('disk full'));
      expect(() => native.setCurve('exponential')).toThrow(RangeError);
      const failing = native.failLater();
      expect(failing).toBeInstanceOf(Promise);
      await expect(failing).rejects.toThrow('later');
    });

    it('async methods resolve values and null, and check arguments first', async () => {
      await expect(native.loadPreset('sync')).resolves.toEqual({
        name: 'sync',
        gains: [0.5, 1],
      });
      await expect(native.loadPreset('missing')).resolves.toBeNull();
      const later = native.loadPreset('later');
      pending.shift()!({ name: 'later', gains: [1] });
      await expect(later).resolves.toEqual({ name: 'later', gains: [1] });
      // Thrown before any promise exists, as the native bindings do.
      expect(error(() => untyped['loadPreset']!(1))).toBe(
        'TypeError: loadPreset(): path: expected string, got number',
      );
      await expect(native.failLater()).rejects.toThrow('later');
    });
  });
});
