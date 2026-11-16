/** The Rust SDK's schema-driven, little-endian controller value encoding. */
import type { WebNativeType, WebNativeTypeDeclaration } from './manifest';

type Types = readonly WebNativeTypeDeclaration[];

/** Encodes already validated arguments, in the method's declared order. */
export function encodeNative(
  values: readonly unknown[],
  types: readonly WebNativeType[],
  declarations: Types,
): Uint8Array {
  const out: number[] = [];
  const put = (bytes: Uint8Array) => {
    for (const byte of bytes) out.push(byte);
  };
  const number = (kind: string, value: unknown): void => {
    const [size, suffix] = numeric(kind);
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    if (suffix === 'BigInt64') view.setBigInt64(0, value as bigint, true);
    else if (suffix === 'BigUint64')
      view.setBigUint64(0, value as bigint, true);
    else {
      const set = view[`set${suffix}` as 'setFloat64'];
      set.call(view, 0, value as number, true);
    }
    put(bytes);
  };
  const write = (type: WebNativeType, value: unknown): void => {
    switch (type.kind) {
      case 'void':
        return;
      case 'primitive':
        if (type.name === 'boolean') {
          out.push(value ? 1 : 0);
          return;
        }
        if (type.name === 'string') {
          const bytes = new TextEncoder().encode(value as string);
          number('uint32', bytes.length);
          put(bytes);
          return;
        }
        number(type.name, value);
        return;
      case 'nullable':
        out.push(value === null ? 0 : 1);
        if (value !== null) write(type.inner, value);
        return;
      case 'array':
      case 'buffer': {
        const items = value as ArrayLike<unknown>;
        number('uint32', items.length);
        for (let i = 0; i < items.length; i++) {
          if (type.kind === 'array') write(type.element, items[i]);
          else number(type.element, items[i]);
        }
        return;
      }
      case 'declared': {
        const declaration = declarations.find((d) => d.name === type.name)!;
        if (declaration.kind === 'enum')
          number('uint32', declaration.values.indexOf(value as string));
        else
          for (const field of declaration.fields)
            write(field.type, (value as Record<string, unknown>)[field.name]);
      }
    }
  };
  types.forEach((type, i) => write(type, values[i]));
  return Uint8Array.from(out);
}

export function decodeNative(
  bytes: Uint8Array,
  type: WebNativeType,
  declarations: Types,
): unknown {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const take = (size: number): number => {
    if (size > bytes.length - offset)
      throw new Error('Truncated Rust controller value');
    const start = offset;
    offset += size;
    return start;
  };
  const number = (kind: string): number | bigint => {
    const [size, suffix] = numeric(kind);
    const start = take(size);
    const get = view[`get${suffix}` as 'getFloat64'];
    return get.call(view, start, true);
  };
  const count = (): number => {
    const value = number('uint32') as number;
    if (value > bytes.length - offset)
      throw new Error('Invalid Rust controller value count');
    return value;
  };
  const read = (type: WebNativeType): unknown => {
    switch (type.kind) {
      case 'void':
        return undefined;
      case 'primitive':
        if (type.name === 'boolean') {
          const value = number('uint8');
          if (value !== 0 && value !== 1)
            throw new Error('Invalid Rust boolean');
          return value === 1;
        }
        if (type.name === 'string') {
          const length = count();
          return new TextDecoder('utf-8', { fatal: true }).decode(
            bytes.subarray(take(length), offset),
          );
        }
        return number(type.name);
      case 'nullable': {
        const tag = number('uint8');
        if (tag === 0) return null;
        if (tag !== 1) throw new Error('Invalid Rust nullable tag');
        return read(type.inner);
      }
      case 'array':
        return Array.from({ length: count() }, () => read(type.element));
      case 'buffer': {
        const length = count();
        const constructors = {
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
        };
        const Type = constructors[type.element];
        const result = new Type(length);
        for (let i = 0; i < length; i++)
          (result as unknown as Record<number, number | bigint>)[i] = number(
            type.element,
          );
        return result;
      }
      case 'declared': {
        const declaration = declarations.find((d) => d.name === type.name)!;
        if (declaration.kind === 'enum') {
          const value = declaration.values[number('uint32') as number];
          if (value === undefined) throw new Error('Invalid Rust enum');
          return value;
        }
        return Object.fromEntries(
          declaration.fields.map((field) => [field.name, read(field.type)]),
        );
      }
    }
  };
  const value = read(type);
  if (offset !== bytes.length)
    throw new Error('Trailing Rust controller bytes');
  return value;
}

function numeric(kind: string): readonly [number, string] {
  const types: Record<string, readonly [number, string]> = {
    int8: [1, 'Int8'],
    uint8: [1, 'Uint8'],
    int16: [2, 'Int16'],
    uint16: [2, 'Uint16'],
    int32: [4, 'Int32'],
    uint32: [4, 'Uint32'],
    int64: [8, 'BigInt64'],
    uint64: [8, 'BigUint64'],
    float32: [4, 'Float32'],
    float64: [8, 'Float64'],
  };
  const type = types[kind];
  if (type === undefined) throw new Error(`Invalid numeric type: ${kind}`);
  return type;
}
