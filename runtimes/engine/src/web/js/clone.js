// structuredClone(): the structured clone algorithm over the values a Soundor
// runtime has. Functions, symbols and other unclonable values throw a
// DataCloneError, as in browsers.

const TYPED_ARRAYS = [
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
];

const ERRORS = {
  Error,
  EvalError,
  RangeError,
  ReferenceError,
  SyntaxError,
  TypeError,
  URIError,
};

/** Platform classes (e.g. Blob) register how they clone. */
const cloners = new Map();

export function registerCloneable(type, clone) {
  cloners.set(type, clone);
}

function fail(what) {
  return new DOMException(`${what} could not be cloned.`, 'DataCloneError');
}

export function structuredClone(value, options = undefined) {
  if (arguments.length === 0) {
    throw new TypeError("structuredClone() requires a 'value' argument");
  }
  const transfer = [...(options?.transfer ?? [])];
  const seen = new Set();
  for (const buffer of transfer) {
    if (!(buffer instanceof ArrayBuffer))
      throw fail('A non-ArrayBuffer transfer item');
    if (seen.has(buffer)) throw fail('A duplicate transfer item');
    if (buffer.detached) throw fail('A detached ArrayBuffer');
    seen.add(buffer);
  }
  // Clone everything (views read their buffers' layout while still intact),
  // then detach the transferred originals: observably a move.
  const copy = clone(value, new Map());
  for (const buffer of transfer) buffer.transfer();
  return copy;
}

function clone(value, memory) {
  const type = typeof value;
  if (type === 'symbol') throw fail('A Symbol');
  if (type === 'function')
    throw fail(value.name ? `function ${value.name}` : 'A function');
  if (value === null || type !== 'object') return value;
  if (memory.has(value)) return memory.get(value);

  const remember = (copy) => {
    memory.set(value, copy);
    return copy;
  };

  if (value instanceof ArrayBuffer) {
    if (value.detached) throw fail('A detached ArrayBuffer');
    return remember(value.slice(0));
  }
  if (ArrayBuffer.isView(value)) {
    const buffer = clone(value.buffer, memory);
    if (value instanceof DataView) {
      return remember(new DataView(buffer, value.byteOffset, value.byteLength));
    }
    const Type = TYPED_ARRAYS.find((candidate) => value instanceof candidate);
    return remember(new Type(buffer, value.byteOffset, value.length));
  }
  if (value instanceof Date) return remember(new Date(value.getTime()));
  if (value instanceof RegExp)
    return remember(new RegExp(value.source, value.flags));
  if (value instanceof Boolean) return remember(new Boolean(value.valueOf()));
  if (value instanceof Number) return remember(new Number(value.valueOf()));
  if (value instanceof String) return remember(new String(value.valueOf()));
  if (value instanceof BigInt) return remember(Object(value.valueOf()));
  if (value instanceof Map) {
    const copy = remember(new Map());
    for (const [key, item] of value) {
      copy.set(clone(key, memory), clone(item, memory));
    }
    return copy;
  }
  if (value instanceof Set) {
    const copy = remember(new Set());
    for (const item of value) copy.add(clone(item, memory));
    return copy;
  }
  for (const [Type, cloneTyped] of cloners) {
    if (value instanceof Type) return remember(cloneTyped(value));
  }
  if (value instanceof Error) {
    const Type = ERRORS[value.name] ?? Error;
    const copy = remember(Object.create(Type.prototype));
    for (const key of ['message', 'stack']) {
      if (Object.hasOwn(value, key)) {
        Object.defineProperty(copy, key, {
          value: String(value[key]),
          writable: true,
          configurable: true,
        });
      }
    }
    if (Object.hasOwn(value, 'cause')) copy.cause = clone(value.cause, memory);
    return copy;
  }
  if (
    value instanceof Promise ||
    value instanceof WeakMap ||
    value instanceof WeakSet
  ) {
    throw fail(`A ${value.constructor.name}`);
  }
  if (Array.isArray(value)) {
    const copy = remember(new Array(value.length));
    for (const key of Object.keys(value)) copy[key] = clone(value[key], memory);
    return copy;
  }
  // Any other object clones as a plain object of its own enumerable data.
  const copy = remember({});
  for (const key of Object.keys(value)) copy[key] = clone(value[key], memory);
  return copy;
}
