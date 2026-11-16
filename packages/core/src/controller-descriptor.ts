/**
 * The descriptor of a plugin's Rust controller: what soundor.config makes of
 * its native methods, their types, its parameters and its persistent state,
 * as bytes. `soundor gen` writes the same bytes into the Rust SDK (which the
 * controller hands the runtime) and into a native runtime's generated code
 * (which checks them, and converts JavaScript values with the types they
 * describe): equal bytes are one contract, and different ones a stale build.
 *
 * Its encoding is the controller's value encoding (little-endian; a count
 * or a string's UTF-8 length as a uint32 before what it counts):
 *
 * ```text
 * "SNDC"  uint32 version (1)
 * uint32 parameterCount
 * uint32 typeCount, each:   uint8 kind (0 struct, 1 enum)  string name
 *                           uint32 count, each: string field  Type  (struct)
 *                                                 string value       (enum)
 * uint32 stateFieldCount, each:  string name  Type
 * uint32 methodCount, each: string name  uint8 async
 *                           uint32 argCount, each: string name  Type
 *                           Type returns
 * Type: uint8 tag (DESCRIPTOR_TAGS), then for a declared type its uint32
 *       index in the types, for an array or a nullable its element's Type,
 *       for a buffer its element's uint8 tag
 * ```
 */
import type {
  NativeApiModel,
  NativeType,
  PrimitiveTypeName,
} from './native-api';
import type { StateSchema } from './state';

/** Each type's tag in a descriptor. */
export const DESCRIPTOR_TAGS = {
  void: 0,
  boolean: 1,
  string: 2,
  int8: 3,
  uint8: 4,
  int16: 5,
  uint16: 6,
  int32: 7,
  uint32: 8,
  int64: 9,
  uint64: 10,
  float32: 11,
  float64: 12,
  declared: 13,
  array: 14,
  buffer: 15,
  nullable: 16,
} as const;

export const DESCRIPTOR_VERSION = 1;

class Writer {
  readonly bytes: number[] = [];

  u8(value: number): void {
    this.bytes.push(value & 0xff);
  }

  u32(value: number): void {
    for (let shift = 0; shift < 32; shift += 8)
      this.bytes.push((value >>> shift) & 0xff);
  }

  string(text: string): void {
    const encoded = new TextEncoder().encode(text);
    this.u32(encoded.length);
    this.bytes.push(...encoded);
  }
}

/** The controller descriptor of a plugin's contract. */
export function describeController(
  native: NativeApiModel,
  state: StateSchema,
  parameterCount: number,
): Uint8Array {
  const out = new Writer();
  const indices = new Map(
    native.types.map((type, index) => [type.name, index]),
  );
  const type = (value: NativeType): void => {
    switch (value.kind) {
      case 'void':
        return out.u8(DESCRIPTOR_TAGS.void);
      case 'primitive':
        return out.u8(DESCRIPTOR_TAGS[value.name as PrimitiveTypeName]);
      case 'declared': {
        const index = indices.get(value.name);
        if (index === undefined)
          throw new TypeError(`native type ${value.name} is not declared`);
        out.u8(DESCRIPTOR_TAGS.declared);
        return out.u32(index);
      }
      case 'array':
        out.u8(DESCRIPTOR_TAGS.array);
        return type(value.element);
      case 'buffer':
        out.u8(DESCRIPTOR_TAGS.buffer);
        return out.u8(DESCRIPTOR_TAGS[value.element]);
      case 'nullable':
        out.u8(DESCRIPTOR_TAGS.nullable);
        return type(value.inner);
    }
  };
  for (const c of 'SNDC') out.u8(c.charCodeAt(0));
  out.u32(DESCRIPTOR_VERSION);
  out.u32(parameterCount);
  out.u32(native.types.length);
  for (const declared of native.types) {
    out.u8(declared.kind === 'struct' ? 0 : 1);
    out.string(declared.name);
    if (declared.kind === 'struct') {
      out.u32(declared.fields.length);
      for (const field of declared.fields) {
        out.string(field.name);
        type(field.type);
      }
    } else {
      out.u32(declared.values.length);
      for (const value of declared.values) out.string(value);
    }
  }
  out.u32(state.fields.length);
  for (const field of state.fields) {
    out.string(field.name);
    type(field.type);
  }
  out.u32(native.methods.length);
  for (const method of native.methods) {
    out.string(method.name);
    out.u8(method.async ? 1 : 0);
    out.u32(method.args.length);
    for (const arg of method.args) {
      out.string(arg.name);
      type(arg.type);
    }
    type(method.returns);
  }
  return Uint8Array.from(out.bytes);
}

/** Bytes as a comma-separated list of literals, `width` to a line. */
export function byteLiterals(
  bytes: Uint8Array,
  indent: string,
  width = 16,
): string {
  const lines: string[] = [];
  for (let start = 0; start < bytes.length; start += width)
    lines.push(
      `${indent}${Array.from(bytes.subarray(start, start + width)).join(', ')},`,
    );
  return lines.join('\n');
}
