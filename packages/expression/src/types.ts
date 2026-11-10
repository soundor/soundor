/**
 * The types of the expression language. They say what a value is (a 32-bit
 * float, a 16-bit unsigned integer), not what one language calls it, so the
 * same expression means the same thing in every language it compiles to.
 */

/** Fixed-width integers. Up to 32 bits a JavaScript number, 64 bits a bigint. */
export const INTEGER_TYPES = [
  'int8',
  'uint8',
  'int16',
  'uint16',
  'int32',
  'uint32',
  'int64',
  'uint64',
] as const;

/** IEEE 754 binary32 and binary64. */
export const FLOAT_TYPES = ['float32', 'float64'] as const;

export const NUMERIC_TYPES = [...INTEGER_TYPES, ...FLOAT_TYPES] as const;

export const SCALAR_TYPES = [...NUMERIC_TYPES, 'boolean', 'string'] as const;

export type IntegerType = (typeof INTEGER_TYPES)[number];
export type FloatType = (typeof FLOAT_TYPES)[number];
export type NumericType = (typeof NUMERIC_TYPES)[number];
/** The integers JavaScript holds as a bigint. */
export type BigIntType = 'int64' | 'uint64';
export type ScalarType = (typeof SCALAR_TYPES)[number];
/** A number or `null`: what parsing text gives. */
export type NullableType = `${NumericType}?`;
/** The type of an expression's value. */
export type ExpressionType = ScalarType | NullableType;

/** `float32` of `float32?`; a non-nullable type stays as it is. */
export type BaseType<T extends ExpressionType> = T extends `${infer B}?`
  ? B & NumericType
  : T;

/** The JavaScript value of a type: what compiled JavaScript computes. */
export type JsValue<T extends ExpressionType> = T extends BigIntType
  ? bigint
  : T extends NumericType
    ? number
    : T extends 'boolean'
      ? boolean
      : T extends 'string'
        ? string
        : T extends `${infer B}?`
          ? JsValue<B & NumericType> | null
          : never;

/** What a literal of a type is written as in the builder. */
export type LiteralValue<T extends ExpressionType> = T extends BigIntType
  ? bigint
  : T extends NumericType
    ? number
    : T extends 'boolean'
      ? boolean
      : T extends 'string'
        ? string
        : never;

export interface IntegerInfo {
  readonly bits: 8 | 16 | 32 | 64;
  readonly signed: boolean;
  readonly min: bigint;
  readonly max: bigint;
}

function integer(bits: 8 | 16 | 32 | 64, signed: boolean): IntegerInfo {
  const width = BigInt(bits);
  return signed
    ? {
        bits,
        signed,
        min: -(1n << (width - 1n)),
        max: (1n << (width - 1n)) - 1n,
      }
    : { bits, signed, min: 0n, max: (1n << width) - 1n };
}

/** Width, signedness and bounds of every integer type. */
export const INTEGERS: Readonly<Record<IntegerType, IntegerInfo>> = {
  int8: integer(8, true),
  uint8: integer(8, false),
  int16: integer(16, true),
  uint16: integer(16, false),
  int32: integer(32, true),
  uint32: integer(32, false),
  int64: integer(64, true),
  uint64: integer(64, false),
};

export function isIntegerType(type: string): type is IntegerType {
  return (INTEGER_TYPES as readonly string[]).includes(type);
}

export function isFloatType(type: string): type is FloatType {
  return type === 'float32' || type === 'float64';
}

export function isNumericType(type: string): type is NumericType {
  return isIntegerType(type) || isFloatType(type);
}

export function isBigIntType(type: string): type is BigIntType {
  return type === 'int64' || type === 'uint64';
}

export function isNullableType(type: string): type is NullableType {
  return type.endsWith('?') && isNumericType(type.slice(0, -1));
}

export function isExpressionType(type: unknown): type is ExpressionType {
  return (
    typeof type === 'string' &&
    ((SCALAR_TYPES as readonly string[]).includes(type) || isNullableType(type))
  );
}

/** The base type of a nullable type, or the type itself. */
export function baseType(type: ExpressionType): ScalarType {
  return isNullableType(type) ? (type.slice(0, -1) as NumericType) : type;
}
