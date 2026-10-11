(function (exports, require, module) {"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.URLSearchParams = exports.URL = void 0;



  var _platform = require("soundor:internal/platform");
  var _encoding = require("soundor:internal/web/encoding");function _classCallCheck(a, n) {if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");}function _defineProperties(e, r) {for (var t = 0; t < r.length; t++) {var o = r[t];o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o);}}function _createClass(e, r, t) {return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e;}function _toPropertyKey(t) {var i = _toPrimitive(t, "string");return "symbol" == typeof i ? i : i + "";}function _toPrimitive(t, e) {if ("object" != typeof t || !t) return t;var r;if ("undefined" != typeof Symbol && void 0 !== (r = t[Symbol.toPrimitive])) {var i = r.call(t, e || "default");if ("object" != typeof i) return i;throw new TypeError("@@toPrimitive must return a primitive value.");}return ("string" === e ? String : Number)(t);}function _classPrivateFieldLooseBase(e, t) {if (!{}.hasOwnProperty.call(e, t)) throw new TypeError("attempted to use private field on non-instance");return e;} // URL and URLSearchParams (WHATWG URL Standard). Parsing and setters are ada's;
  // URLSearchParams is the standard's application/x-www-form-urlencoded parser
  // and serializer.
  var HREF = 0;var ORIGIN = 1;
  var PROTOCOL = 2;
  var USERNAME = 3;
  var PASSWORD = 4;
  var HOST = 5;
  var HOSTNAME = 6;
  var PORT = 7;
  var PATHNAME = 8;
  var SEARCH = 9;
  var HASH = 10;

  var encoder = new _encoding.TextEncoder();
  var decoder = new _encoding.TextDecoder();

  /** Links a URL to its searchParams without public API. */
  var attachParams;
  var setParamsFromQuery;var _parts = Symbol("parts");var _params = Symbol("params");var _set = Symbol("set");var

  URL = exports.URL = /*#__PURE__*/function () {



    function URL(url, base = undefined) {_classCallCheck(this, URL);Object.defineProperty(this, _set, { value: _set2 });Object.defineProperty(this, _parts, { writable: true, value: void 0 });Object.defineProperty(this, _params, { writable: true, value: null });
      var _parts2 = (0, _platform.urlParse)(
        String(url),
        base === undefined ? undefined : String(base)
      );
      if (_parts2 === null) throw new TypeError(`Invalid URL: ${String(url)}`);
      this[_parts] = _parts2;
    }return _createClass(URL, [{ key: "href", get:

























      function () {
        return this[_parts][HREF];
      }, set:
      function (value) {
        this[_set]('href', value);
      } }, { key: "origin", get:
      function () {
        return this[_parts][ORIGIN];
      } }, { key: "protocol", get:
      function () {
        return this[_parts][PROTOCOL];
      }, set:
      function (value) {
        this[_set]('protocol', value);
      } }, { key: "username", get:
      function () {
        return this[_parts][USERNAME];
      }, set:
      function (value) {
        this[_set]('username', value);
      } }, { key: "password", get:
      function () {
        return this[_parts][PASSWORD];
      }, set:
      function (value) {
        this[_set]('password', value);
      } }, { key: "host", get:
      function () {
        return this[_parts][HOST];
      }, set:
      function (value) {
        this[_set]('host', value);
      } }, { key: "hostname", get:
      function () {
        return this[_parts][HOSTNAME];
      }, set:
      function (value) {
        this[_set]('hostname', value);
      } }, { key: "port", get:
      function () {
        return this[_parts][PORT];
      }, set:
      function (value) {
        this[_set]('port', value);
      } }, { key: "pathname", get:
      function () {
        return this[_parts][PATHNAME];
      }, set:
      function (value) {
        this[_set]('pathname', value);
      } }, { key: "search", get:
      function () {
        return this[_parts][SEARCH];
      }, set:
      function (value) {
        this[_set]('search', value);
      } }, { key: "hash", get:
      function () {
        return this[_parts][HASH];
      }, set:
      function (value) {
        this[_set]('hash', value);
      } }, { key: "searchParams", get:

      function () {
        if (this[_params] === null) {
          this[_params] = new URLSearchParams(this[_parts][SEARCH]);
          attachParams(this[_params], (query) => {
            this[_parts] = (0, _platform.urlSet)(this[_parts][HREF], 'search', query);
          });
        }
        return this[_params];
      } }, { key: "toString", value:

      function toString() {
        return this.href;
      } }, { key: "toJSON", value:
      function toJSON() {
        return this.href;
      } }], [{ key: "canParse", value: function canParse(url, base = undefined) {return (0, _platform.urlParse)(String(url), base === undefined ? undefined : String(base)) !== null;} }, { key: "parse", value: function parse(url, base = undefined) {try {return new URL(url, base);} catch {return null;}} }]);}();


  // ── application/x-www-form-urlencoded ────────────────────────────────────────
  function _set2(component, value) {var parts = (0, _platform.urlSet)(this[_parts][HREF], component, String(value));if (parts === null) throw new TypeError(`Invalid URL: ${String(value)}`);this[_parts] = parts;if (component === 'href' || component === 'search') {setParamsFromQuery?.(this[_params], this[_parts][SEARCH]);}}
  function percentDecode(text) {
    var bytes = encoder.encode(text);
    var out = new Uint8Array(bytes.length);
    var length = 0;
    for (var i = 0; i < bytes.length; i++) {
      var byte = bytes[i];
      if (byte === 0x25 && i + 2 < bytes.length) {
        var hex = String.fromCharCode(bytes[i + 1], bytes[i + 2]);
        if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
          out[length++] = Number.parseInt(hex, 16);
          i += 2;
          continue;
        }
      }
      out[length++] = byte;
    }
    return decoder.decode(out.subarray(0, length));
  }

  function parseQuery(query) {
    var pairs = [];
    for (var sequence of query.split('&')) {
      if (sequence === '') continue;
      var equals = sequence.indexOf('=');
      var name = equals < 0 ? sequence : sequence.slice(0, equals);
      var value = equals < 0 ? '' : sequence.slice(equals + 1);
      pairs.push([
      percentDecode(name.replaceAll('+', ' ')),
      percentDecode(value.replaceAll('+', ' '))]
      );
    }
    return pairs;
  }

  var SAFE = /[A-Za-z0-9*\-._]/;

  function serializeComponent(text) {
    var out = '';
    for (var byte of encoder.encode(text)) {
      var char = String.fromCharCode(byte);
      if (byte === 0x20) out += '+';else
      if (byte < 0x80 && SAFE.test(char)) out += char;else
      out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
    return out;
  }

  /** USVString conversion: lone surrogates become U+FFFD. */
  function usv(value) {
    return String(value).toWellFormed();
  }var _pairs = Symbol("pairs");var _onChange = Symbol("onChange");var _update = Symbol("update");var

  URLSearchParams = exports.URLSearchParams = /*#__PURE__*/function () {



    function URLSearchParams(init = '') {_classCallCheck(this, URLSearchParams);Object.defineProperty(this, _update, { value: _update2 });Object.defineProperty(this, _pairs, { writable: true, value: [] });Object.defineProperty(this, _onChange, { writable: true, value: null });
      if (init instanceof URLSearchParams) {
        this[_pairs] = init[_pairs].map(([name, value]) => [name, value]);
      } else if (
      typeof init === 'object' &&
      init !== null &&
      typeof init[Symbol.iterator] === 'function')
      {
        for (var pair of init) {
          var entry = [...pair];
          if (entry.length !== 2) {
            throw new TypeError(
              'URLSearchParams pairs must have exactly two items'
            );
          }
          this[_pairs].push([usv(entry[0]), usv(entry[1])]);
        }
      } else if (typeof init === 'object' && init !== null) {
        for (var key of Object.keys(init))
        this[_pairs].push([usv(key), usv(init[key])]);
      } else {
        var query = usv(init);
        this[_pairs] = parseQuery(query.startsWith('?') ? query.slice(1) : query);
      }
    }return _createClass(URLSearchParams, [{ key: "size", get:

















      function () {
        return this[_pairs].length;
      } }, { key: "append", value:

      function append(name, value) {
        this[_pairs].push([usv(name), usv(value)]);
        this[_update]();
      } }, { key: "delete", value:

      function _delete(name, value = undefined) {
        var key = usv(name);
        var match = value === undefined ? undefined : usv(value);
        this[_pairs] = this[_pairs].filter(
          ([n, v]) => n !== key || match !== undefined && v !== match
        );
        this[_update]();
      } }, { key: "get", value:

      function get(name) {
        var key = usv(name);
        return this[_pairs].find(([n]) => n === key)?.[1] ?? null;
      } }, { key: "getAll", value:

      function getAll(name) {
        var key = usv(name);
        return this[_pairs].filter(([n]) => n === key).map(([, v]) => v);
      } }, { key: "has", value:

      function has(name, value = undefined) {
        var key = usv(name);
        var match = value === undefined ? undefined : usv(value);
        return this[_pairs].some(
          ([n, v]) => n === key && (match === undefined || v === match)
        );
      } }, { key: "set", value:

      function set(name, value) {
        var key = usv(name);
        var index = this[_pairs].findIndex(([n]) => n === key);
        if (index < 0) {
          this[_pairs].push([key, usv(value)]);
        } else {
          this[_pairs][index] = [key, usv(value)];
          this[_pairs] = this[_pairs].filter(([n], i) => n !== key || i <= index);
        }
        this[_update]();
      } }, { key: "sort", value:

      function sort() {
        // Stable sort by UTF-16 code units, as the standard requires.
        this[_pairs] = this[_pairs].
        map((pair, index) => [pair, index]).
        sort(([[a], i], [[b], j]) => a < b ? -1 : a > b ? 1 : i - j).
        map(([pair]) => pair);
        this[_update]();
      } }, { key: "forEach", value:

      function forEach(callback, thisArg = undefined) {
        for (var [name, value] of [...this[_pairs]])
        callback.call(thisArg, value, name, this);
      } }, { key: "entries", value:

      function* entries() {
        for (var [name, value] of this[_pairs]) yield [name, value];
      } }, { key: "keys", value:

      function* keys() {
        for (var [name] of this[_pairs]) yield name;
      } }, { key: "values", value:

      function* values() {
        for (var [, value] of this[_pairs]) yield value;
      } }, { key:

      Symbol.iterator, value: function () {
        return this.entries();
      } }, { key: "toString", value:

      function toString() {
        return this[_pairs].
        map(
          ([name, value]) =>
          `${serializeComponent(name)}=${serializeComponent(value)}`
        ).
        join('&');
      } }]);}();function _update2() {if (this[_onChange]) this[_onChange](this.toString());}(() => {attachParams = (params, onChange) => {params[_onChange] = onChange;};setParamsFromQuery = (params, search) => {if (params !== null) params[_pairs] = parseQuery(search.startsWith('?') ? search.slice(1) : search);};})();});
// Generated from native/src/web/js/url.js by scripts/native-modules.mjs. Do not edit.
