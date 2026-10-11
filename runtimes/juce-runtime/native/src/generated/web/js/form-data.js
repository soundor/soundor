(function (exports, require, module) {"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.FormData = void 0;

  var _blob = require("soundor:internal/web/blob");function _classCallCheck(a, n) {if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");}function _defineProperties(e, r) {for (var t = 0; t < r.length; t++) {var o = r[t];o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o);}}function _createClass(e, r, t) {return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e;}function _toPropertyKey(t) {var i = _toPrimitive(t, "string");return "symbol" == typeof i ? i : i + "";}function _toPrimitive(t, e) {if ("object" != typeof t || !t) return t;var r;if ("undefined" != typeof Symbol && void 0 !== (r = t[Symbol.toPrimitive])) {var i = r.call(t, e || "default");if ("object" != typeof i) return i;throw new TypeError("@@toPrimitive must return a primitive value.");}return ("string" === e ? String : Number)(t);}function _classPrivateFieldLooseBase(e, t) {if (!{}.hasOwnProperty.call(e, t)) throw new TypeError("attempted to use private field on non-instance");return e;} // FormData: ordered name/value entries, values being strings or Files.

  function entryValue(value, filename) {
    if (value instanceof _blob.Blob) {
      if (filename !== undefined) {
        return new _blob.File([value], String(filename), { type: value.type });
      }
      return value instanceof _blob.File ?
      value :
      new _blob.File([value], 'blob', { type: value.type });
    }
    return String(value).toWellFormed();
  }var _entries = Symbol("entries");var

  FormData = exports.FormData = /*#__PURE__*/function () {


    function FormData(form = undefined) {_classCallCheck(this, FormData);Object.defineProperty(this, _entries, { writable: true, value: [] });
      if (form !== undefined) {
        throw new TypeError('FormData has no HTML forms to read in Soundor');
      }
    }return _createClass(FormData, [{ key: "append", value:

      function append(name, value, filename = undefined) {
        this[_entries].push([String(name), entryValue(value, filename)]);
      } }, { key: "set", value:

      function set(name, value, filename = undefined) {
        var key = String(name);
        var entry = [key, entryValue(value, filename)];
        var index = this[_entries].findIndex(([n]) => n === key);
        if (index < 0) {
          this[_entries].push(entry);
        } else {
          this[_entries][index] = entry;
          this[_entries] = this[_entries].filter(([n], i) => n !== key || i <= index);
        }
      } }, { key: "get", value:

      function get(name) {
        var key = String(name);
        return this[_entries].find(([n]) => n === key)?.[1] ?? null;
      } }, { key: "getAll", value:

      function getAll(name) {
        var key = String(name);
        return this[_entries].filter(([n]) => n === key).map(([, value]) => value);
      } }, { key: "has", value:

      function has(name) {
        var key = String(name);
        return this[_entries].some(([n]) => n === key);
      } }, { key: "delete", value:

      function _delete(name) {
        var key = String(name);
        this[_entries] = this[_entries].filter(([n]) => n !== key);
      } }, { key: "forEach", value:

      function forEach(callback, thisArg = undefined) {
        for (var [name, value] of [...this[_entries]])
        callback.call(thisArg, value, name, this);
      } }, { key: "entries", value:

      function* entries() {
        for (var [name, value] of this[_entries]) yield [name, value];
      } }, { key: "keys", value:

      function* keys() {
        for (var [name] of this[_entries]) yield name;
      } }, { key: "values", value:

      function* values() {
        for (var [, value] of this[_entries]) yield value;
      } }, { key:

      Symbol.iterator, value: function () {
        return this.entries();
      } }]);}();});
// Generated from native/src/web/js/form-data.js by scripts/native-modules.mjs. Do not edit.
