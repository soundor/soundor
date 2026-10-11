(function (exports, require, module) {"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.cleanupFinalized = cleanupFinalized;exports.takeRejections = takeRejections;

















  var _languageNative = require("soundor:internal/language-native");function asyncGeneratorStep(n, t, e, r, o, a, c) {try {var i = n[a](c),u = i.value;} catch (n) {return void e(n);}i.done ? t(u) : Promise.resolve(u).then(r, o);}function _asyncToGenerator(n) {return function () {var t = this,e = arguments;return new Promise(function (r, o) {var a = n.apply(t, e);function _next(n) {asyncGeneratorStep(a, r, o, _next, _throw, "next", n);}function _throw(n) {asyncGeneratorStep(a, r, o, _next, _throw, "throw", n);}_next(void 0);});};} // `soundor:internal/language` — the ECMAScript of a Soundor context, as far as
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
  var define = (target, name, value) => {if (Object.prototype.hasOwnProperty.call(target, name)) return;Object.defineProperty(target, name, { value, writable: true, enumerable: false, configurable: true });};var isObject = (value) => typeof value === 'object' && value !== null || typeof value === 'function'; // ── Promise rejection tracking ────────────────────────────────────────────
  /** Rejected promises without a handler, and their reasons. */var unhandled = new Map();

  Promise._m = (promise, reason) => {
    if (promise._h === 0) unhandled.set(promise, reason);
  };
  Promise._l = (promise) => {
    if (unhandled.size !== 0) unhandled.delete(promise);
  };

  /** The reasons of rejections nobody handled since the last call. */
  function takeRejections() {
    if (unhandled.size === 0) return undefined;
    var reasons = [...unhandled.values()];
    unhandled.clear();
    return reasons;
  }

  // ── FinalizationRegistry ──────────────────────────────────────────────────

  var STATE = Symbol('FinalizationRegistry');
  /** Cell token → the registry it belongs to. */
  var registries = new Map();
  var nextToken = 1;

  /** Runs the cleanup callbacks of the cells whose targets were collected. */
  function cleanupFinalized(tokens) {var _loop = function ()
      {
        var registry = registries.get(token);
        if (registry === undefined) return 0; // continue
        registries.delete(token);
        var state = registry[STATE];
        if (!state.cells.has(token)) return 0; // continue
        var held = state.cells.get(token);
        state.cells.delete(token);
        // Like a job: one failing callback does not stop the others.
        try {
          state.cleanup.call(undefined, held);
        } catch (error) {
          queueMicrotask(() => {
            throw error;
          });
        }
      },_ret;for (var token of tokens) {_ret = _loop();if (_ret === 0) continue;}
  }

  function FinalizationRegistry(cleanup) {
    if (!new.target) {
      throw new TypeError("Constructor FinalizationRegistry requires 'new'");
    }
    if (typeof cleanup !== 'function') {
      throw new TypeError('FinalizationRegistry: cleanup must be callable');
    }
    Object.defineProperty(this, STATE, {
      value: { cleanup, cells: new Map(), byToken: new WeakMap() }
    });
  }

  function stateOf(registry, method) {
    var state = isObject(registry) ? registry[STATE] : undefined;
    if (state === undefined) {
      throw new TypeError(
        `FinalizationRegistry.prototype.${method} called on an incompatible receiver`
      );
    }
    return state;
  }

  define(
    FinalizationRegistry.prototype,
    'register',
    function register(target, heldValue, unregisterToken) {
      var state = stateOf(this, 'register');
      if (!isObject(target)) {
        throw new TypeError(
          'FinalizationRegistry.prototype.register: invalid target'
        );
      }
      if (Object.is(target, heldValue)) {
        throw new TypeError(
          'FinalizationRegistry.prototype.register: target and held value must not be the same'
        );
      }
      if (unregisterToken !== undefined && !isObject(unregisterToken)) {
        throw new TypeError(
          'FinalizationRegistry.prototype.register: invalid unregister token'
        );
      }
      var token = nextToken;
      nextToken = nextToken === 0xffffffff ? 1 : nextToken + 1;
      (0, _languageNative.watch)(target, token);
      state.cells.set(token, heldValue);
      registries.set(token, this);
      if (unregisterToken !== undefined) {
        var tokens = state.byToken.get(unregisterToken);
        if (tokens === undefined) {
          tokens = [];
          state.byToken.set(unregisterToken, tokens);
        }
        tokens.push(token);
      }
      return undefined;
    }
  );

  define(
    FinalizationRegistry.prototype,
    'unregister',
    function unregister(unregisterToken) {
      var state = stateOf(this, 'unregister');
      if (!isObject(unregisterToken)) {
        throw new TypeError(
          'FinalizationRegistry.prototype.unregister: invalid unregister token'
        );
      }
      var tokens = state.byToken.get(unregisterToken);
      if (tokens === undefined) return false;
      state.byToken.delete(unregisterToken);
      var removed = false;
      for (var token of tokens) {
        if (state.cells.delete(token)) removed = true;
        registries.delete(token);
      }
      return removed;
    }
  );

  Object.defineProperty(FinalizationRegistry.prototype, Symbol.toStringTag, {
    value: 'FinalizationRegistry',
    configurable: true
  });

  define(globalThis, 'FinalizationRegistry', FinalizationRegistry);

  // ── Global functions and well-known symbols ───────────────────────────────

  define(globalThis, 'queueMicrotask', function queueMicrotask(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('queueMicrotask: the callback must be a function');
    }
    HermesInternal.enqueueJob(() => callback());
  });

  for (var name of ['asyncIterator', 'dispose', 'asyncDispose']) {
    if (Symbol[name] === undefined) {
      Object.defineProperty(Symbol, name, { value: Symbol(`Symbol.${name}`) });
    }
  }

  // ── Promise ───────────────────────────────────────────────────────────────

  if (
  !Object.prototype.hasOwnProperty.call(Promise.prototype, Symbol.toStringTag))
  {
    Object.defineProperty(Promise.prototype, Symbol.toStringTag, {
      value: 'Promise',
      configurable: true
    });
  }

  define(Promise, 'withResolvers', function withResolvers() {
    var resolve;
    var reject;
    var promise = new this((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  });

  define(Promise, 'try', function (callback, ...args) {
    return new this((resolve) => resolve(callback(...args)));
  });

  // ── Arrays and typed arrays ───────────────────────────────────────────────

  var toIntegerOrInfinity = (value) => {
    var number = Number(value);
    if (Number.isNaN(number) || number === 0) return 0;
    if (!Number.isFinite(number)) return number;
    return Math.trunc(number);
  };

  define(Array.prototype, 'toSorted', function toSorted(compare) {
    if (compare !== undefined && typeof compare !== 'function') {
      throw new TypeError(
        'Array.prototype.toSorted: the comparator must be a function'
      );
    }
    return Array.prototype.slice.call(this).sort(compare);
  });

  define(Array, 'fromAsync', /*#__PURE__*/function () {var _fromAsync = _asyncToGenerator(function* (items, mapper, thisArg) {
      if (mapper !== undefined && typeof mapper !== 'function') {
        throw new TypeError('Array.fromAsync: the mapper must be a function');
      }
      var result = [];
      var iterator =
      items[Symbol.asyncIterator] !== undefined ?
      items[Symbol.asyncIterator]() :
      items[Symbol.iterator] !== undefined ?
      items[Symbol.iterator]() :
      undefined;
      if (iterator === undefined) {
        var length = toIntegerOrInfinity(items.length);
        for (var i = 0; i < length; i++) {
          var value = yield items[i];
          result.push(
            mapper === undefined ? value : yield mapper.call(thisArg, value, i)
          );
        }
        return result;
      }
      for (var index = 0;; index++) {
        var step = yield iterator.next();
        if (step.done) return result;
        var _value = yield step.value;
        result.push(
          mapper === undefined ? _value : yield mapper.call(thisArg, _value, index)
        );
      }
    });function fromAsync(_x, _x2, _x3) {return _fromAsync.apply(this, arguments);}return fromAsync;}());

  if (!Object.prototype.hasOwnProperty.call(ArrayBuffer.prototype, 'detached')) {
    Object.defineProperty(ArrayBuffer.prototype, 'detached', {
      get: function detached() {
        return (0, _languageNative.isDetached)(this);
      },
      configurable: true
    });
  }

  /** transfer() and transferToFixedLength(): a copy, then the original detached. */
  var transfer = (buffer, newLength, method) => {
    if ((0, _languageNative.isDetached)(buffer)) {
      throw new TypeError(
        `ArrayBuffer.prototype.${method}: the ArrayBuffer is detached`
      );
    }
    var length =
    newLength === undefined ?
    buffer.byteLength :
    toIntegerOrInfinity(newLength);
    if (length < 0 || !Number.isFinite(length)) {
      throw new RangeError(`ArrayBuffer.prototype.${method}: invalid length`);
    }
    var copy = new ArrayBuffer(length);
    new Uint8Array(copy).set(
      new Uint8Array(buffer, 0, Math.min(length, buffer.byteLength))
    );
    (0, _languageNative.detach)(buffer);
    return copy;
  };

  define(ArrayBuffer.prototype, 'transfer', function (newLength) {
    return transfer(this, newLength, 'transfer');
  });

  define(ArrayBuffer.prototype, 'transferToFixedLength', function (newLength) {
    return transfer(this, newLength, 'transferToFixedLength');
  });

  var TypedArray = Object.getPrototypeOf(Int8Array);

  define(TypedArray.prototype, 'toReversed', function toReversed() {
    return this.slice().reverse();
  });

  define(TypedArray.prototype, 'toSorted', function toSorted(compare) {
    if (compare !== undefined && typeof compare !== 'function') {
      throw new TypeError(
        'TypedArray.prototype.toSorted: the comparator must be a function'
      );
    }
    return this.slice().sort(compare);
  });

  define(TypedArray.prototype, 'with', function (index, value) {
    var length = this.length;
    var relative = toIntegerOrInfinity(index);
    var actual = relative >= 0 ? relative : length + relative;
    if (actual < 0 || actual >= length) {
      throw new RangeError('TypedArray.prototype.with: index out of range');
    }
    var copy = this.slice();
    copy[actual] = value;
    return copy;
  });

  // ── Grouping ──────────────────────────────────────────────────────────────

  var groupInto = (items, callback, add) => {
    if (typeof callback !== 'function') {
      throw new TypeError('groupBy: the callback must be a function');
    }
    var index = 0;
    for (var item of items) add(callback(item, index++), item);
  };

  define(Object, 'groupBy', function groupBy(items, callback) {
    var groups = Object.create(null);
    groupInto(items, callback, (key, item) => {
      var property = typeof key === 'symbol' ? key : String(key);
      (groups[property] ??= []).push(item);
    });
    return groups;
  });

  define(Map, 'groupBy', function groupBy(items, callback) {
    var groups = new Map();
    groupInto(items, callback, (key, item) => {
      var normalized = Object.is(key, -0) ? 0 : key;
      var group = groups.get(normalized);
      if (group === undefined) groups.set(normalized, group = []);
      group.push(item);
    });
    return groups;
  });

  // ── Set methods ───────────────────────────────────────────────────────────

  /** The "set-like" record of an argument: size, has() and keys(). */
  var setRecord = (other) => {
    if (!isObject(other))
    throw new TypeError('Set method: the argument must be set-like');
    var size = Number(other.size);
    if (Number.isNaN(size))
    throw new TypeError('Set method: the argument has no size');
    var { has, keys } = other;
    if (typeof has !== 'function' || typeof keys !== 'function') {
      throw new TypeError('Set method: the argument needs has() and keys()');
    }
    return {
      size,
      has: (value) => Boolean(has.call(other, value)),
      *keys() {
        var iterator = keys.call(other);
        for (var step = iterator.next(); !step.done; step = iterator.next())
        yield step.value;
      }
    };
  };

  define(Set.prototype, 'union', function union(other) {
    var record = setRecord(other);
    var result = new Set(this);
    for (var value of record.keys()) result.add(value);
    return result;
  });

  define(Set.prototype, 'intersection', function intersection(other) {
    var record = setRecord(other);
    var result = new Set();
    if (this.size <= record.size) {
      for (var value of this) if (record.has(value)) result.add(value);
    } else {
      for (var _value2 of record.keys()) if (this.has(_value2)) result.add(_value2);
    }
    return result;
  });

  define(Set.prototype, 'difference', function difference(other) {
    var record = setRecord(other);
    var result = new Set(this);
    if (this.size <= record.size) {
      for (var value of this) if (record.has(value)) result.delete(value);
    } else {
      for (var _value3 of record.keys()) result.delete(_value3);
    }
    return result;
  });

  define(
    Set.prototype,
    'symmetricDifference',
    function symmetricDifference(other) {
      var record = setRecord(other);
      var result = new Set(this);
      for (var value of record.keys()) {
        if (this.has(value)) result.delete(value);else
        result.add(value);
      }
      return result;
    }
  );

  define(Set.prototype, 'isSubsetOf', function isSubsetOf(other) {
    var record = setRecord(other);
    if (this.size > record.size) return false;
    for (var value of this) if (!record.has(value)) return false;
    return true;
  });

  define(Set.prototype, 'isSupersetOf', function isSupersetOf(other) {
    var record = setRecord(other);
    if (this.size < record.size) return false;
    for (var value of record.keys()) if (!this.has(value)) return false;
    return true;
  });

  define(Set.prototype, 'isDisjointFrom', function isDisjointFrom(other) {
    var record = setRecord(other);
    if (this.size <= record.size) {
      for (var value of this) if (record.has(value)) return false;
    } else {
      for (var _value4 of record.keys()) if (this.has(_value4)) return false;
    }
    return true;
  });

  // ── Strings and errors ────────────────────────────────────────────────────

  var isLoneSurrogate = (text, i) => {
    var code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      var next = text.charCodeAt(i + 1);
      return !(next >= 0xdc00 && next <= 0xdfff);
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      var previous = text.charCodeAt(i - 1);
      return !(previous >= 0xd800 && previous <= 0xdbff);
    }
    return false;
  };

  define(String.prototype, 'isWellFormed', function isWellFormed() {
    var text = String(this);
    for (var i = 0; i < text.length; i++)
    if (isLoneSurrogate(text, i)) return false;
    return true;
  });

  define(String.prototype, 'toWellFormed', function toWellFormed() {
    var text = String(this);
    var result = '';
    for (var i = 0; i < text.length; i++) {
      result += isLoneSurrogate(text, i) ? '�' : text[i];
    }
    return result;
  });

  define(Error, 'isError', function isError(value) {
    return Object.prototype.toString.call(value) === '[object Error]';
  });

  // ── Iterator helpers ──────────────────────────────────────────────────────

  var IteratorPrototype = Object.getPrototypeOf(
    Object.getPrototypeOf([][Symbol.iterator]())
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
    !Object.prototype.hasOwnProperty.call(IteratorPrototype, Symbol.toStringTag))
    {
      Object.defineProperty(IteratorPrototype, Symbol.toStringTag, {
        value: 'Iterator',
        configurable: true,
        writable: true
      });
    }

    /** A helper's iterator, from a generator over the underlying one. */
    var helper = (generator) => {
      var result = Object.create(IteratorPrototype);
      define(result, 'next', (...args) => generator.next(...args));
      define(result, 'return', (value) => generator.return(value));
      return result;
    };

    var direct = (iterator) => {
      if (!isObject(iterator))
      throw new TypeError('Iterator helper called on a non-object');
      var next = iterator.next;
      if (typeof next !== 'function')
      throw new TypeError('Iterator helper: next is not a function');
      return { iterator, next };
    };

    function* steps({ iterator, next }) {
      var completed = false;
      try {
        for (;;) {
          var step = next.call(iterator);
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

    var callable = (callback, method) => {
      if (typeof callback !== 'function') {
        throw new TypeError(
          `Iterator.prototype.${method}: the callback must be a function`
        );
      }
    };

    define(Iterator, 'from', function from(value) {
      var method =
      isObject(value) || typeof value === 'string' ?
      value[Symbol.iterator] :
      undefined;
      var iterator = method === undefined ? value : method.call(value);
      if (iterator instanceof Iterator) return iterator;
      return helper(steps(direct(iterator)));
    });

    define(IteratorPrototype, 'map', function map(callback) {
      callable(callback, 'map');
      var record = direct(this);
      return helper(
        function* () {
          var index = 0;
          for (var value of steps(record)) yield callback(value, index++);
        }()
      );
    });

    define(IteratorPrototype, 'filter', function filter(callback) {
      callable(callback, 'filter');
      var record = direct(this);
      return helper(
        function* () {
          var index = 0;
          for (var value of steps(record))
          if (callback(value, index++)) yield value;
        }()
      );
    });

    var count = (limit, method) => {
      var number = Number(limit);
      if (Number.isNaN(number))
      throw new RangeError(`Iterator.prototype.${method}: not a number`);
      var integer = toIntegerOrInfinity(number);
      if (integer < 0)
      throw new RangeError(`Iterator.prototype.${method}: negative count`);
      return integer;
    };

    define(IteratorPrototype, 'take', function take(limit) {
      var remaining = count(limit, 'take');
      var record = direct(this);
      return helper(
        function* () {
          var left = remaining;
          if (left === 0) {
            if (typeof record.iterator.return === 'function')
            record.iterator.return();
            return;
          }
          for (var value of steps(record)) {
            yield value;
            if (--left === 0) return;
          }
        }()
      );
    });

    define(IteratorPrototype, 'drop', function drop(limit) {
      var skip = count(limit, 'drop');
      var record = direct(this);
      return helper(
        function* () {
          var left = skip;
          for (var value of steps(record)) {
            if (left > 0) {
              left--;
              continue;
            }
            yield value;
          }
        }()
      );
    });

    define(IteratorPrototype, 'flatMap', function flatMap(callback) {
      callable(callback, 'flatMap');
      var record = direct(this);
      return helper(
        function* () {
          var index = 0;
          for (var value of steps(record)) {
            var inner = callback(value, index++);
            if (!isObject(inner) && typeof inner !== 'string') {
              throw new TypeError(
                'Iterator.prototype.flatMap: the callback must return an iterable'
              );
            }
            yield* Iterator.from(inner);
          }
        }()
      );
    });

    define(IteratorPrototype, 'reduce', function reduce(callback, ...initial) {
      callable(callback, 'reduce');
      var record = direct(this);
      var index = 0;
      var accumulator;
      var all = steps(record);
      if (initial.length > 0) {
        accumulator = initial[0];
      } else {
        var first = all.next();
        if (first.done)
        throw new TypeError(
          'Iterator.prototype.reduce of an empty iterator with no initial value'
        );
        accumulator = first.value;
        index = 1;
      }
      for (var value of all)
      accumulator = callback(accumulator, value, index++);
      return accumulator;
    });

    define(IteratorPrototype, 'toArray', function toArray() {
      return [...steps(direct(this))];
    });

    define(IteratorPrototype, 'forEach', function forEach(callback) {
      callable(callback, 'forEach');
      var index = 0;
      for (var value of steps(direct(this))) callback(value, index++);
    });

    define(IteratorPrototype, 'some', function some(callback) {
      callable(callback, 'some');
      var index = 0;
      for (var value of steps(direct(this)))
      if (callback(value, index++)) return true;
      return false;
    });

    define(IteratorPrototype, 'every', function every(callback) {
      callable(callback, 'every');
      var index = 0;
      for (var value of steps(direct(this)))
      if (!callback(value, index++)) return false;
      return true;
    });

    define(IteratorPrototype, 'find', function find(callback) {
      callable(callback, 'find');
      var index = 0;
      for (var value of steps(direct(this)))
      if (callback(value, index++)) return value;
      return undefined;
    });

    define(globalThis, 'Iterator', Iterator);
  }});
// Generated from native/src/js/language.js by scripts/native-modules.mjs. Do not edit.
