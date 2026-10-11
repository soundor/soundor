// `soundor:internal/language` — the ECMAScript of a Soundor context, as far as
// Hermes needs completing. Evaluated first in every context, before any other
// module.
//
// - Promise rejection tracking: Hermes's Promise (its internal bytecode, the
//   `promise` package) calls Promise._m when a promise rejects without a
//   handler and Promise._l whenever one is added. A rejection still unhandled
//   when the job queue drains is reported (takeRejections()).
// - FinalizationRegistry, which Hermes lacks: the engine reports collected
//   targets (soundor:internal/language-native's watch(), on the object's
//   native state), and cleanupFinalized() calls the callbacks.
// - Standard built-ins Hermes lacks and libraries use: queueMicrotask,
//   Symbol.asyncIterator/dispose/asyncDispose, Promise.withResolvers/try,
//   Array.fromAsync, Array/TypedArray toSorted & co., Object/Map.groupBy, the
//   Set methods, String well-formedness, Error.isError, the Iterator helpers
//   and ArrayBuffer's transfer()/detached. Each is defined only when missing,
//   non-enumerable like the built-ins.

import { detach, isDetached, watch } from 'soundor:internal/language-native';

const define = (target, name, value) => {
  if (Object.prototype.hasOwnProperty.call(target, name)) return;
  Object.defineProperty(target, name, {
    value,
    writable: true,
    enumerable: false,
    configurable: true,
  });
};

const isObject = (value) =>
  (typeof value === 'object' && value !== null) || typeof value === 'function';

// ── Promise rejection tracking ────────────────────────────────────────────

/** Rejected promises without a handler, and their reasons. */
const unhandled = new Map();

Promise._m = (promise, reason) => {
  if (promise._h === 0) unhandled.set(promise, reason);
};
Promise._l = (promise) => {
  if (unhandled.size !== 0) unhandled.delete(promise);
};

/** The reasons of rejections nobody handled since the last call. */
export function takeRejections() {
  if (unhandled.size === 0) return undefined;
  const reasons = [...unhandled.values()];
  unhandled.clear();
  return reasons;
}

// ── FinalizationRegistry ──────────────────────────────────────────────────

const STATE = Symbol('FinalizationRegistry');
/** Cell token → the registry it belongs to. */
const registries = new Map();
let nextToken = 1;

/** Runs the cleanup callbacks of the cells whose targets were collected. */
export function cleanupFinalized(tokens) {
  for (const token of tokens) {
    const registry = registries.get(token);
    if (registry === undefined) continue;
    registries.delete(token);
    const state = registry[STATE];
    if (!state.cells.has(token)) continue;
    const held = state.cells.get(token);
    state.cells.delete(token);
    // Like a job: one failing callback does not stop the others.
    try {
      state.cleanup.call(undefined, held);
    } catch (error) {
      queueMicrotask(() => {
        throw error;
      });
    }
  }
}

function FinalizationRegistry(cleanup) {
  if (!new.target) {
    throw new TypeError("Constructor FinalizationRegistry requires 'new'");
  }
  if (typeof cleanup !== 'function') {
    throw new TypeError('FinalizationRegistry: cleanup must be callable');
  }
  Object.defineProperty(this, STATE, {
    value: { cleanup, cells: new Map(), byToken: new WeakMap() },
  });
}

function stateOf(registry, method) {
  const state = isObject(registry) ? registry[STATE] : undefined;
  if (state === undefined) {
    throw new TypeError(
      `FinalizationRegistry.prototype.${method} called on an incompatible receiver`,
    );
  }
  return state;
}

define(
  FinalizationRegistry.prototype,
  'register',
  function register(target, heldValue, unregisterToken) {
    const state = stateOf(this, 'register');
    if (!isObject(target)) {
      throw new TypeError(
        'FinalizationRegistry.prototype.register: invalid target',
      );
    }
    if (Object.is(target, heldValue)) {
      throw new TypeError(
        'FinalizationRegistry.prototype.register: target and held value must not be the same',
      );
    }
    if (unregisterToken !== undefined && !isObject(unregisterToken)) {
      throw new TypeError(
        'FinalizationRegistry.prototype.register: invalid unregister token',
      );
    }
    const token = nextToken;
    nextToken = nextToken === 0xffffffff ? 1 : nextToken + 1;
    watch(target, token);
    state.cells.set(token, heldValue);
    registries.set(token, this);
    if (unregisterToken !== undefined) {
      let tokens = state.byToken.get(unregisterToken);
      if (tokens === undefined) {
        tokens = [];
        state.byToken.set(unregisterToken, tokens);
      }
      tokens.push(token);
    }
    return undefined;
  },
);

define(
  FinalizationRegistry.prototype,
  'unregister',
  function unregister(unregisterToken) {
    const state = stateOf(this, 'unregister');
    if (!isObject(unregisterToken)) {
      throw new TypeError(
        'FinalizationRegistry.prototype.unregister: invalid unregister token',
      );
    }
    const tokens = state.byToken.get(unregisterToken);
    if (tokens === undefined) return false;
    state.byToken.delete(unregisterToken);
    let removed = false;
    for (const token of tokens) {
      if (state.cells.delete(token)) removed = true;
      registries.delete(token);
    }
    return removed;
  },
);

Object.defineProperty(FinalizationRegistry.prototype, Symbol.toStringTag, {
  value: 'FinalizationRegistry',
  configurable: true,
});

define(globalThis, 'FinalizationRegistry', FinalizationRegistry);

// ── Global functions and well-known symbols ───────────────────────────────

define(globalThis, 'queueMicrotask', function queueMicrotask(callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('queueMicrotask: the callback must be a function');
  }
  HermesInternal.enqueueJob(() => callback());
});

for (const name of ['asyncIterator', 'dispose', 'asyncDispose']) {
  if (Symbol[name] === undefined) {
    Object.defineProperty(Symbol, name, { value: Symbol(`Symbol.${name}`) });
  }
}

// ── Promise ───────────────────────────────────────────────────────────────

if (
  !Object.prototype.hasOwnProperty.call(Promise.prototype, Symbol.toStringTag)
) {
  Object.defineProperty(Promise.prototype, Symbol.toStringTag, {
    value: 'Promise',
    configurable: true,
  });
}

define(Promise, 'withResolvers', function withResolvers() {
  let resolve;
  let reject;
  const promise = new this((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
});

define(Promise, 'try', function (callback, ...args) {
  return new this((resolve) => resolve(callback(...args)));
});

// ── Arrays and typed arrays ───────────────────────────────────────────────

const toIntegerOrInfinity = (value) => {
  const number = Number(value);
  if (Number.isNaN(number) || number === 0) return 0;
  if (!Number.isFinite(number)) return number;
  return Math.trunc(number);
};

define(Array.prototype, 'toSorted', function toSorted(compare) {
  if (compare !== undefined && typeof compare !== 'function') {
    throw new TypeError(
      'Array.prototype.toSorted: the comparator must be a function',
    );
  }
  return Array.prototype.slice.call(this).sort(compare);
});

define(Array, 'fromAsync', async function fromAsync(items, mapper, thisArg) {
  if (mapper !== undefined && typeof mapper !== 'function') {
    throw new TypeError('Array.fromAsync: the mapper must be a function');
  }
  const result = [];
  const iterator =
    items[Symbol.asyncIterator] !== undefined
      ? items[Symbol.asyncIterator]()
      : items[Symbol.iterator] !== undefined
        ? items[Symbol.iterator]()
        : undefined;
  if (iterator === undefined) {
    const length = toIntegerOrInfinity(items.length);
    for (let i = 0; i < length; i++) {
      const value = await items[i];
      result.push(
        mapper === undefined ? value : await mapper.call(thisArg, value, i),
      );
    }
    return result;
  }
  for (let index = 0; ; index++) {
    const step = await iterator.next();
    if (step.done) return result;
    const value = await step.value;
    result.push(
      mapper === undefined ? value : await mapper.call(thisArg, value, index),
    );
  }
});

if (!Object.prototype.hasOwnProperty.call(ArrayBuffer.prototype, 'detached')) {
  Object.defineProperty(ArrayBuffer.prototype, 'detached', {
    get: function detached() {
      return isDetached(this);
    },
    configurable: true,
  });
}

/** transfer() and transferToFixedLength(): a copy, then the original detached. */
const transfer = (buffer, newLength, method) => {
  if (isDetached(buffer)) {
    throw new TypeError(
      `ArrayBuffer.prototype.${method}: the ArrayBuffer is detached`,
    );
  }
  const length =
    newLength === undefined
      ? buffer.byteLength
      : toIntegerOrInfinity(newLength);
  if (length < 0 || !Number.isFinite(length)) {
    throw new RangeError(`ArrayBuffer.prototype.${method}: invalid length`);
  }
  const copy = new ArrayBuffer(length);
  new Uint8Array(copy).set(
    new Uint8Array(buffer, 0, Math.min(length, buffer.byteLength)),
  );
  detach(buffer);
  return copy;
};

define(ArrayBuffer.prototype, 'transfer', function (newLength) {
  return transfer(this, newLength, 'transfer');
});

define(ArrayBuffer.prototype, 'transferToFixedLength', function (newLength) {
  return transfer(this, newLength, 'transferToFixedLength');
});

const TypedArray = Object.getPrototypeOf(Int8Array);

define(TypedArray.prototype, 'toReversed', function toReversed() {
  return this.slice().reverse();
});

define(TypedArray.prototype, 'toSorted', function toSorted(compare) {
  if (compare !== undefined && typeof compare !== 'function') {
    throw new TypeError(
      'TypedArray.prototype.toSorted: the comparator must be a function',
    );
  }
  return this.slice().sort(compare);
});

define(TypedArray.prototype, 'with', function (index, value) {
  const length = this.length;
  const relative = toIntegerOrInfinity(index);
  const actual = relative >= 0 ? relative : length + relative;
  if (actual < 0 || actual >= length) {
    throw new RangeError('TypedArray.prototype.with: index out of range');
  }
  const copy = this.slice();
  copy[actual] = value;
  return copy;
});

// ── Grouping ──────────────────────────────────────────────────────────────

const groupInto = (items, callback, add) => {
  if (typeof callback !== 'function') {
    throw new TypeError('groupBy: the callback must be a function');
  }
  let index = 0;
  for (const item of items) add(callback(item, index++), item);
};

define(Object, 'groupBy', function groupBy(items, callback) {
  const groups = Object.create(null);
  groupInto(items, callback, (key, item) => {
    const property = typeof key === 'symbol' ? key : String(key);
    (groups[property] ??= []).push(item);
  });
  return groups;
});

define(Map, 'groupBy', function groupBy(items, callback) {
  const groups = new Map();
  groupInto(items, callback, (key, item) => {
    const normalized = Object.is(key, -0) ? 0 : key;
    let group = groups.get(normalized);
    if (group === undefined) groups.set(normalized, (group = []));
    group.push(item);
  });
  return groups;
});

// ── Set methods ───────────────────────────────────────────────────────────

/** The "set-like" record of an argument: size, has() and keys(). */
const setRecord = (other) => {
  if (!isObject(other))
    throw new TypeError('Set method: the argument must be set-like');
  const size = Number(other.size);
  if (Number.isNaN(size))
    throw new TypeError('Set method: the argument has no size');
  const { has, keys } = other;
  if (typeof has !== 'function' || typeof keys !== 'function') {
    throw new TypeError('Set method: the argument needs has() and keys()');
  }
  return {
    size,
    has: (value) => Boolean(has.call(other, value)),
    *keys() {
      const iterator = keys.call(other);
      for (let step = iterator.next(); !step.done; step = iterator.next())
        yield step.value;
    },
  };
};

define(Set.prototype, 'union', function union(other) {
  const record = setRecord(other);
  const result = new Set(this);
  for (const value of record.keys()) result.add(value);
  return result;
});

define(Set.prototype, 'intersection', function intersection(other) {
  const record = setRecord(other);
  const result = new Set();
  if (this.size <= record.size) {
    for (const value of this) if (record.has(value)) result.add(value);
  } else {
    for (const value of record.keys()) if (this.has(value)) result.add(value);
  }
  return result;
});

define(Set.prototype, 'difference', function difference(other) {
  const record = setRecord(other);
  const result = new Set(this);
  if (this.size <= record.size) {
    for (const value of this) if (record.has(value)) result.delete(value);
  } else {
    for (const value of record.keys()) result.delete(value);
  }
  return result;
});

define(
  Set.prototype,
  'symmetricDifference',
  function symmetricDifference(other) {
    const record = setRecord(other);
    const result = new Set(this);
    for (const value of record.keys()) {
      if (this.has(value)) result.delete(value);
      else result.add(value);
    }
    return result;
  },
);

define(Set.prototype, 'isSubsetOf', function isSubsetOf(other) {
  const record = setRecord(other);
  if (this.size > record.size) return false;
  for (const value of this) if (!record.has(value)) return false;
  return true;
});

define(Set.prototype, 'isSupersetOf', function isSupersetOf(other) {
  const record = setRecord(other);
  if (this.size < record.size) return false;
  for (const value of record.keys()) if (!this.has(value)) return false;
  return true;
});

define(Set.prototype, 'isDisjointFrom', function isDisjointFrom(other) {
  const record = setRecord(other);
  if (this.size <= record.size) {
    for (const value of this) if (record.has(value)) return false;
  } else {
    for (const value of record.keys()) if (this.has(value)) return false;
  }
  return true;
});

// ── Strings and errors ────────────────────────────────────────────────────

const isLoneSurrogate = (text, i) => {
  const code = text.charCodeAt(i);
  if (code >= 0xd800 && code <= 0xdbff) {
    const next = text.charCodeAt(i + 1);
    return !(next >= 0xdc00 && next <= 0xdfff);
  }
  if (code >= 0xdc00 && code <= 0xdfff) {
    const previous = text.charCodeAt(i - 1);
    return !(previous >= 0xd800 && previous <= 0xdbff);
  }
  return false;
};

define(String.prototype, 'isWellFormed', function isWellFormed() {
  const text = String(this);
  for (let i = 0; i < text.length; i++)
    if (isLoneSurrogate(text, i)) return false;
  return true;
});

define(String.prototype, 'toWellFormed', function toWellFormed() {
  const text = String(this);
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += isLoneSurrogate(text, i) ? '�' : text[i];
  }
  return result;
});

define(Error, 'isError', function isError(value) {
  return Object.prototype.toString.call(value) === '[object Error]';
});

// ── Iterator helpers ──────────────────────────────────────────────────────

const IteratorPrototype = Object.getPrototypeOf(
  Object.getPrototypeOf([][Symbol.iterator]()),
);

if (globalThis.Iterator === undefined) {
  function Iterator() {
    if (new.target === undefined || new.target === Iterator) {
      throw new TypeError('Iterator is an abstract class');
    }
  }
  Iterator.prototype = IteratorPrototype;
  define(IteratorPrototype, 'constructor', Iterator);
  if (
    !Object.prototype.hasOwnProperty.call(IteratorPrototype, Symbol.toStringTag)
  ) {
    Object.defineProperty(IteratorPrototype, Symbol.toStringTag, {
      value: 'Iterator',
      configurable: true,
      writable: true,
    });
  }

  /** A helper's iterator, from a generator over the underlying one. */
  const helper = (generator) => {
    const result = Object.create(IteratorPrototype);
    define(result, 'next', (...args) => generator.next(...args));
    define(result, 'return', (value) => generator.return(value));
    return result;
  };

  const direct = (iterator) => {
    if (!isObject(iterator))
      throw new TypeError('Iterator helper called on a non-object');
    const next = iterator.next;
    if (typeof next !== 'function')
      throw new TypeError('Iterator helper: next is not a function');
    return { iterator, next };
  };

  function* steps({ iterator, next }) {
    let completed = false;
    try {
      for (;;) {
        const step = next.call(iterator);
        if (step.done) {
          completed = true;
          return;
        }
        yield step.value;
      }
    } finally {
      if (!completed && typeof iterator.return === 'function')
        iterator.return();
    }
  }

  const callable = (callback, method) => {
    if (typeof callback !== 'function') {
      throw new TypeError(
        `Iterator.prototype.${method}: the callback must be a function`,
      );
    }
  };

  define(Iterator, 'from', function from(value) {
    const method =
      isObject(value) || typeof value === 'string'
        ? value[Symbol.iterator]
        : undefined;
    const iterator = method === undefined ? value : method.call(value);
    if (iterator instanceof Iterator) return iterator;
    return helper(steps(direct(iterator)));
  });

  define(IteratorPrototype, 'map', function map(callback) {
    callable(callback, 'map');
    const record = direct(this);
    return helper(
      (function* () {
        let index = 0;
        for (const value of steps(record)) yield callback(value, index++);
      })(),
    );
  });

  define(IteratorPrototype, 'filter', function filter(callback) {
    callable(callback, 'filter');
    const record = direct(this);
    return helper(
      (function* () {
        let index = 0;
        for (const value of steps(record))
          if (callback(value, index++)) yield value;
      })(),
    );
  });

  const count = (limit, method) => {
    const number = Number(limit);
    if (Number.isNaN(number))
      throw new RangeError(`Iterator.prototype.${method}: not a number`);
    const integer = toIntegerOrInfinity(number);
    if (integer < 0)
      throw new RangeError(`Iterator.prototype.${method}: negative count`);
    return integer;
  };

  define(IteratorPrototype, 'take', function take(limit) {
    const remaining = count(limit, 'take');
    const record = direct(this);
    return helper(
      (function* () {
        let left = remaining;
        if (left === 0) {
          if (typeof record.iterator.return === 'function')
            record.iterator.return();
          return;
        }
        for (const value of steps(record)) {
          yield value;
          if (--left === 0) return;
        }
      })(),
    );
  });

  define(IteratorPrototype, 'drop', function drop(limit) {
    const skip = count(limit, 'drop');
    const record = direct(this);
    return helper(
      (function* () {
        let left = skip;
        for (const value of steps(record)) {
          if (left > 0) {
            left--;
            continue;
          }
          yield value;
        }
      })(),
    );
  });

  define(IteratorPrototype, 'flatMap', function flatMap(callback) {
    callable(callback, 'flatMap');
    const record = direct(this);
    return helper(
      (function* () {
        let index = 0;
        for (const value of steps(record)) {
          const inner = callback(value, index++);
          if (!isObject(inner) && typeof inner !== 'string') {
            throw new TypeError(
              'Iterator.prototype.flatMap: the callback must return an iterable',
            );
          }
          yield* Iterator.from(inner);
        }
      })(),
    );
  });

  define(IteratorPrototype, 'reduce', function reduce(callback, ...initial) {
    callable(callback, 'reduce');
    const record = direct(this);
    let index = 0;
    let accumulator;
    const all = steps(record);
    if (initial.length > 0) {
      accumulator = initial[0];
    } else {
      const first = all.next();
      if (first.done)
        throw new TypeError(
          'Iterator.prototype.reduce of an empty iterator with no initial value',
        );
      accumulator = first.value;
      index = 1;
    }
    for (const value of all)
      accumulator = callback(accumulator, value, index++);
    return accumulator;
  });

  define(IteratorPrototype, 'toArray', function toArray() {
    return [...steps(direct(this))];
  });

  define(IteratorPrototype, 'forEach', function forEach(callback) {
    callable(callback, 'forEach');
    let index = 0;
    for (const value of steps(direct(this))) callback(value, index++);
  });

  define(IteratorPrototype, 'some', function some(callback) {
    callable(callback, 'some');
    let index = 0;
    for (const value of steps(direct(this)))
      if (callback(value, index++)) return true;
    return false;
  });

  define(IteratorPrototype, 'every', function every(callback) {
    callable(callback, 'every');
    let index = 0;
    for (const value of steps(direct(this)))
      if (!callback(value, index++)) return false;
    return true;
  });

  define(IteratorPrototype, 'find', function find(callback) {
    callable(callback, 'find');
    let index = 0;
    for (const value of steps(direct(this)))
      if (callback(value, index++)) return value;
    return undefined;
  });

  define(globalThis, 'Iterator', Iterator);
}
