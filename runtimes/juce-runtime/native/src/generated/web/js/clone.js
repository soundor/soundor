(function (exports, require, module) {"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.registerCloneable = registerCloneable;exports.structuredClone = structuredClone; // structuredClone(): the structured clone algorithm over the values a Soundor
  // runtime has. Functions, symbols and other unclonable values throw a
  // DataCloneError, as in browsers.

  var TYPED_ARRAYS = [
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
  BigUint64Array];


  var ERRORS = {
    Error,
    EvalError,
    RangeError,
    ReferenceError,
    SyntaxError,
    TypeError,
    URIError
  };

  /** Platform classes (e.g. Blob) register how they clone. */
  var cloners = new Map();

  function registerCloneable(type, clone) {
    cloners.set(type, clone);
  }

  function fail(what) {
    return new DOMException(`${what} could not be cloned.`, 'DataCloneError');
  }

  function structuredClone(value, options = undefined) {
    if (arguments.length === 0) {
      throw new TypeError("structuredClone() requires a 'value' argument");
    }
    var transfer = [...(options?.transfer ?? [])];
    var seen = new Set();
    for (var buffer of transfer) {
      if (!(buffer instanceof ArrayBuffer))
      throw fail('A non-ArrayBuffer transfer item');
      if (seen.has(buffer)) throw fail('A duplicate transfer item');
      if (buffer.detached) throw fail('A detached ArrayBuffer');
      seen.add(buffer);
    }
    // Clone everything (views read their buffers' layout while still intact),
    // then detach the transferred originals: observably a move.
    var copy = clone(value, new Map());
    for (var _buffer of transfer) _buffer.transfer();
    return copy;
  }

  function clone(value, memory) {
    var type = typeof value;
    if (type === 'symbol') throw fail('A Symbol');
    if (type === 'function')
    throw fail(value.name ? `function ${value.name}` : 'A function');
    if (value === null || type !== 'object') return value;
    if (memory.has(value)) return memory.get(value);

    var remember = (copy) => {
      memory.set(value, copy);
      return copy;
    };

    if (value instanceof ArrayBuffer) {
      if (value.detached) throw fail('A detached ArrayBuffer');
      return remember(value.slice(0));
    }
    if (ArrayBuffer.isView(value)) {
      var buffer = clone(value.buffer, memory);
      if (value instanceof DataView) {
        return remember(new DataView(buffer, value.byteOffset, value.byteLength));
      }
      var Type = TYPED_ARRAYS.find((candidate) => value instanceof candidate);
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
      var _copy = remember(new Map());
      for (var [key, item] of value) {
        _copy.set(clone(key, memory), clone(item, memory));
      }
      return _copy;
    }
    if (value instanceof Set) {
      var _copy2 = remember(new Set());
      for (var _item of value) _copy2.add(clone(_item, memory));
      return _copy2;
    }
    for (var [_Type, cloneTyped] of cloners) {
      if (value instanceof _Type) return remember(cloneTyped(value));
    }
    if (value instanceof Error) {
      var _Type2 = ERRORS[value.name] ?? Error;
      var _copy3 = remember(Object.create(_Type2.prototype));
      for (var _key of ['message', 'stack']) {
        if (Object.hasOwn(value, _key)) {
          Object.defineProperty(_copy3, _key, {
            value: String(value[_key]),
            writable: true,
            configurable: true
          });
        }
      }
      if (Object.hasOwn(value, 'cause')) _copy3.cause = clone(value.cause, memory);
      return _copy3;
    }
    if (
    value instanceof Promise ||
    value instanceof WeakMap ||
    value instanceof WeakSet)
    {
      throw fail(`A ${value.constructor.name}`);
    }
    if (Array.isArray(value)) {
      var _copy4 = remember(new Array(value.length));
      for (var _key2 of Object.keys(value)) _copy4[_key2] = clone(value[_key2], memory);
      return _copy4;
    }
    // Any other object clones as a plain object of its own enumerable data.
    var copy = remember({});
    for (var _key3 of Object.keys(value)) copy[_key3] = clone(value[_key3], memory);
    return copy;
  }});
// Generated from native/src/web/js/clone.js by scripts/native-modules.mjs. Do not edit.
