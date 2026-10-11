(function (exports, require, module) {"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.storage = void 0;



  var _platform = require("soundor:internal/platform");function asyncGeneratorStep(n, t, e, r, o, a, c) {try {var i = n[a](c),u = i.value;} catch (n) {return void e(n);}i.done ? t(u) : Promise.resolve(u).then(r, o);}function _asyncToGenerator(n) {return function () {var t = this,e = arguments;return new Promise(function (r, o) {var a = n.apply(t, e);function _next(n) {asyncGeneratorStep(a, r, o, _next, _throw, "next", n);}function _throw(n) {asyncGeneratorStep(a, r, o, _next, _throw, "throw", n);}_next(void 0);});};} // soundor:storage — small, persistent, plugin-scoped key/value storage. Values
  // are anything JSON can represent; every operation is asynchronous and lands
  // on disk before its promise resolves.
  function key(value) {if (typeof value !== 'string')
    throw new TypeError('Storage keys must be strings');
    return value;
  }

  var storage = exports.storage = Object.freeze({
    /** The stored value, or undefined. */
    get(name) {return _asyncToGenerator(function* () {
        var text = yield (0, _platform.storageOperation)('get', key(name), '');
        return text === undefined ? undefined : JSON.parse(text);})();
    },

    /** Stores a JSON-serializable value. */
    set(name, value) {return _asyncToGenerator(function* () {
        var text = JSON.stringify(value);
        if (text === undefined) {
          throw new TypeError(
            `soundor:storage cannot store ${typeof value} values; store JSON data`
          );
        }
        yield (0, _platform.storageOperation)('set', key(name), text);})();
    },

    delete(name) {return _asyncToGenerator(function* () {
        yield (0, _platform.storageOperation)('delete', key(name), '');})();
    },

    /** Every stored key, sorted. */
    keys() {
      return (0, _platform.storageOperation)('keys', '', '');
    },

    clear() {return _asyncToGenerator(function* () {
        yield (0, _platform.storageOperation)('clear', '', '');})();
    }
  });});
// Generated from native/src/modules/storage/storage.js by scripts/native-modules.mjs. Do not edit.
