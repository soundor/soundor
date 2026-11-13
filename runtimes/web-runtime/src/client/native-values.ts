/**
 * The values of `soundor:native` calls in the browser, checked and converted
 * as the JUCE runtime's generated bindings do (`js/Bindings.cpp` in the
 * engine): the same rules, the same errors, word for word.
 *
 * - Sized numbers are never coerced: an integer of up to 32 bits is a number
 *   that is an integer within range, a 64-bit integer a bigint, a float32 a
 *   number rounded to the nearest float (Math.fround). The wrong kind of value
 *   is a TypeError, a value out of range a RangeError.
 * - `T?` takes null; undefined is never a value.
 * - Structs and arrays are values: what crosses is a copy with the declared
 *   fields only, so neither side sees the other change it.
 * - A buffer is a typed array of exactly its type. One passed as a method's
 *   argument is the caller's own (the native side borrows it); anywhere else,
 *   and in every result, it is a copy of its own elements.
 */

import type {
  WebNativeEvent,
  WebNativeMethod,
  WebNativeNumeric,
  WebNativeType,
  WebNativeTypeDeclaration,
} from './manifest';

/** Where a value sits in a call, for messages: `centroid(): points[1].y`. */
interface Path {
  readonly parent?: Path;
  /** A method's name at the root, a field's or argument's name below. */
  readonly name?: string;
  /** An array element's index. */
  readonly index?: number;
}

function formatPath(path: Path): string {
  const chain: Path[] = [];
  for (let node: Path | undefined = path; node; node = node.parent)
    chain.unshift(node);
  let text = `${chain[0]!.name ?? '?'}()`;
  chain.slice(1).forEach((node, i) => {
    if (node.name === undefined) text += `[${node.index}]`;
    else text += (i === 0 ? ': ' : '.') + node.name;
  });
  return text;
}

const field = (parent: Path, name: string): Path => ({ parent, name });
const element = (parent: Path, index: number): Path => ({ parent, index });

/** The types a call refers to, by name. */
export type NativeTypes = ReadonlyMap<string, WebNativeTypeDeclaration>;

export function nativeTypes(
  declarations: readonly WebNativeTypeDeclaration[],
): NativeTypes {
  return new Map(declarations.map((type) => [type.name, type]));
}

/**
 * The arguments the implementation receives: each checked and converted.
 * Extra arguments are ignored, as the native bindings ignore them.
 */
export function nativeArguments(
  method: WebNativeMethod,
  args: readonly unknown[],
  types: NativeTypes,
): unknown[] {
  const expected = method.args.length;
  if (args.length < expected) {
    throw new TypeError(
      `${method.name}() expects ${expected} argument${expected === 1 ? '' : 's'}, got ${args.length}`,
    );
  }
  const root: Path = { name: method.name };
  return method.args.map((arg, index) =>
    convert(arg.type, args[index], field(root, arg.name), types, true),
  );
}

/** What the plugin receives from the implementation: checked and copied. */
export function nativeResult(
  method: WebNativeMethod,
  value: unknown,
  types: NativeTypes,
): unknown {
  if (method.returns.kind === 'void') return undefined;
  return convert(
    method.returns,
    value,
    field({ name: method.name }, 'result'),
    types,
    false,
  );
}

function convert(
  type: WebNativeType,
  value: unknown,
  path: Path,
  types: NativeTypes,
  borrow: boolean,
): unknown {
  switch (type.kind) {
    case 'void':
      return undefined;
    case 'primitive':
      return convertPrimitive(type.name, value, path);
    case 'nullable':
      return value === null
        ? null
        : convert(type.inner, value, path, types, borrow);
    case 'buffer':
      return convertBuffer(type.element, value, path, borrow);
    case 'array': {
      if (!Array.isArray(value)) mismatch(path, 'array', value);
      return value.map((item, index) =>
        convert(type.element, item, element(path, index), types, false),
      );
    }
    case 'declared': {
      const declaration = types.get(type.name);
      if (declaration === undefined) {
        throw new Error(`soundor:native: unknown type '${type.name}'`);
      }
      return declaration.kind === 'enum'
        ? convertEnum(declaration.values, value, path)
        : convertStruct(declaration, value, path, types);
    }
  }
}

function convertPrimitive(
  name: 'boolean' | 'string' | WebNativeNumeric,
  value: unknown,
  path: Path,
): unknown {
  switch (name) {
    case 'boolean':
    case 'string':
      if (typeof value !== name) mismatch(path, name, value);
      return value;
    case 'int64':
    case 'uint64': {
      if (typeof value !== 'bigint') mismatch(path, name, value);
      const [min, max] = BIG_RANGES[name];
      if (value < min || value > max)
        outOfRange(path, value, name, `${min} to ${max}`);
      return value;
    }
    case 'float32': {
      if (typeof value !== 'number') mismatch(path, name, value);
      const rounded = Math.fround(value);
      // NaN and the infinities are floats too; a finite number that would
      // round to infinity is not.
      if (Number.isFinite(value) && !Number.isFinite(rounded))
        outOfRange(path, value, name, '');
      return rounded;
    }
    case 'float64':
      if (typeof value !== 'number') mismatch(path, name, value);
      return value;
    default: {
      if (typeof value !== 'number') mismatch(path, name, value);
      if (!Number.isInteger(value)) {
        throw new TypeError(
          `${formatPath(path)}: expected an integer (${name}), got ${String(value)}`,
        );
      }
      const [min, max] = SMALL_RANGES[name];
      if (value < min || value > max)
        outOfRange(path, value, name, `${min} to ${max}`);
      // -0 is the integer 0.
      return value === 0 ? 0 : value;
    }
  }
}

const SMALL_RANGES = {
  int8: [-128, 127],
  uint8: [0, 255],
  int16: [-32768, 32767],
  uint16: [0, 65535],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
} as const;

const BIG_RANGES = {
  int64: [-(2n ** 63n), 2n ** 63n - 1n],
  uint64: [0n, 2n ** 64n - 1n],
} as const;

/** Each buffer element type's typed array. */
const TYPED_ARRAYS = {
  int8: Int8Array,
  uint8: Uint8Array,
  int16: Int16Array,
  uint16: Uint16Array,
  int32: Int32Array,
  uint32: Uint32Array,
  int64: BigInt64Array,
  uint64: BigUint64Array,
  float32: Float32Array,
  float64: Float64Array,
} as const;

/**
 * A typed array's type by its internal slot (not its prototype, which
 * anything can claim), or undefined for anything else.
 */
const typedArrayName = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Int8Array.prototype) as object,
  Symbol.toStringTag,
)!.get as (this: unknown) => string | undefined;

function isArrayBuffer(value: unknown): boolean {
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

function convertBuffer(
  element: WebNativeNumeric,
  value: unknown,
  path: Path,
  borrow: boolean,
): unknown {
  const constructor = TYPED_ARRAYS[element];
  if (typedArrayName.call(value) !== constructor.name)
    mismatch(path, constructor.name, value);
  const array = value as InstanceType<typeof constructor>;
  // `detached` is ES2024; where it is missing a detached buffer reads empty.
  if ((array.buffer as { detached?: boolean }).detached === true) {
    throw new TypeError('ArrayBuffer is detached');
  }
  return borrow ? array : array.slice();
}

function convertEnum(
  values: readonly string[],
  value: unknown,
  path: Path,
): string {
  if (typeof value === 'string' && values.includes(value)) return value;
  const expected = `one of ${values.map((v) => `'${v}'`).join(', ')}`;
  if (typeof value === 'string') {
    throw new TypeError(
      `${formatPath(path)}: expected ${expected}, got '${value}'`,
    );
  }
  mismatch(path, expected, value);
}

function convertStruct(
  declaration: Extract<WebNativeTypeDeclaration, { kind: 'struct' }>,
  value: unknown,
  path: Path,
  types: NativeTypes,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    mismatch(path, 'object', value);
  const object = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const member of declaration.fields) {
    result[member.name] = convert(
      member.type,
      object[member.name],
      field(path, member.name),
      types,
      false,
    );
  }
  return result;
}

/**
 * The value an event's subscribers receive: what its publisher was given,
 * checked and copied as a struct of the event's fields. An event without
 * fields may be published without a value.
 */
export function nativeEventValue(
  event: WebNativeEvent,
  value: unknown,
  types: NativeTypes,
): Record<string, unknown> {
  return convertStruct(
    { kind: 'struct', name: event.name, fields: event.fields },
    value === undefined && event.fields.length === 0 ? {} : value,
    { name: `events.${event.name}` },
    types,
  );
}

/** A short description of a value's type, as the engine gives it. */
export function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typedArrayName.call(value) !== undefined) return 'typed array';
  if (isArrayBuffer(value)) return 'ArrayBuffer';
  return typeof value;
}

function mismatch(path: Path, expected: string, actual: unknown): never {
  throw new TypeError(
    `${formatPath(path)}: expected ${expected}, got ${describeType(actual)}`,
  );
}

function outOfRange(
  path: Path,
  value: number | bigint,
  type: string,
  range: string,
): never {
  throw new RangeError(
    `${formatPath(path)}: ${String(value)} is out of range for ${type}${range === '' ? '' : ` (${range})`}`,
  );
}
