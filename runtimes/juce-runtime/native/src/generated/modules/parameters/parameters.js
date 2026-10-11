(function (exports, require, module) {"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.parameters = void 0;







  var host = _interopRequireWildcard(require("soundor:internal/parameters"));var cache;function _interopRequireWildcard(e, t) {if (!t && e && e.__esModule) return e;var r,c,a = Object.defineProperty,n = { __proto__: null, default: e };if (Object(e) !== e) return n;if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) {if (cache.has(e)) return cache.get(e);cache.set(e, n);}for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]);return n;}function _classCallCheck(a, n) {if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");}function _defineProperties(e, r) {for (var t = 0; t < r.length; t++) {var o = r[t];o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o);}}function _createClass(e, r, t) {return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e;}function _toPropertyKey(t) {var i = _toPrimitive(t, "string");return "symbol" == typeof i ? i : i + "";}function _toPrimitive(t, e) {if ("object" != typeof t || !t) return t;var r;if ("undefined" != typeof Symbol && void 0 !== (r = t[Symbol.toPrimitive])) {var i = r.call(t, e || "default");if ("object" != typeof i) return i;throw new TypeError("@@toPrimitive must return a primitive value.");}return ("string" === e ? String : Number)(t);}function _classPrivateFieldLooseBase(e, t) {if (!{}.hasOwnProperty.call(e, t)) throw new TypeError("attempted to use private field on non-instance");return e;} // `soundor:parameters` — the plugin's parameters as typed objects.
  //
  // Embedded into the native runtime at build time. The native side
  // (`soundor:internal/parameters`, private to runtime modules) holds raw
  // plain-unit values; this layer converts them to the declared JavaScript types,
  // validates input, and keeps the subscriber lists. Subscriptions live and die
  // with the JavaScript context, so a reload never leaves listeners behind.
  var TYPES = ['float', 'int', 'bool', 'enum']; /** Public, frozen metadata in the shape of the soundor.config declaration. */function describe(raw) {var type = TYPES[raw.kind];var info = { id: raw.id, label: raw.label, type };
    switch (type) {
      case 'float':
      case 'int':
        info.min = raw.min;
        info.max = raw.max;
        info.default = raw.default;
        if (raw.unit !== '') info.unit = raw.unit;
        break;
      case 'bool':
        info.default = raw.default >= 0.5;
        break;
      case 'enum':
        info.values = Object.freeze([...raw.choices]);
        info.default = raw.choices[Math.round(raw.default)];
        break;
    }
    return Object.freeze(info);
  }

  function fromHost(info, value) {
    switch (info.type) {
      case 'float':
        return value;
      case 'int':
        return Math.round(value);
      case 'bool':
        return value >= 0.5;
      case 'enum':
        return info.values[Math.round(value)];
    }
  }

  function toHost(info, value) {
    switch (info.type) {
      case 'float':
      case 'int':
        if (typeof value !== 'number' || Number.isNaN(value)) {
          throw new TypeError(
            `Parameter '${info.id}' expects a number, got ${describeValue(value)}`
          );
        }
        return value;
      case 'bool':
        if (typeof value !== 'boolean') {
          throw new TypeError(
            `Parameter '${info.id}' expects a boolean, got ${describeValue(value)}`
          );
        }
        return value ? 1 : 0;
      case 'enum':{
          var index = info.values.indexOf(value);
          if (index < 0) {
            throw new TypeError(
              `Parameter '${info.id}' expects one of ${info.values.map((v) => `'${v}'`).join(', ')}, got ${describeValue(value)}`
            );
          }
          return index;
        }
    }
  }

  function describeValue(value) {
    return typeof value === 'string' ? `'${value}'` : String(value);
  }

  /** index → Set of listeners; only parameters someone listens to have an entry. */
  var subscribers = new Map();var _index = Symbol("index");var _info = Symbol("info");var

  Parameter = /*#__PURE__*/function () {



    function Parameter(index, info) {_classCallCheck(this, Parameter);Object.defineProperty(this, _index, { writable: true, value: void 0 });Object.defineProperty(this, _info, { writable: true, value: void 0 });
      this[_index] = index;
      this[_info] = info;
      Object.freeze(this);
    }return _createClass(Parameter, [{ key: "id", get:

      function () {
        return this[_info].id;
      } }, { key: "info", get:

      function () {
        return this[_info];
      } }, { key: "get", value:

      function get() {
        return fromHost(this[_info], host.get(this[_index]));
      } }, { key: "set", value:

      function set(value) {
        host.set(this[_index], toHost(this[_info], value));
      } }, { key: "subscribe", value:

      function subscribe(listener) {
        if (typeof listener !== 'function') {
          throw new TypeError(
            `Parameter '${this[_info].id}': subscribe() expects a function`
          );
        }
        var listeners = subscribers.get(this[_index]);
        if (listeners === undefined) {
          listeners = new Set();
          subscribers.set(this[_index], listeners);
        }
        // Wrapped so subscribing the same function twice yields two independent
        // subscriptions, each removed by its own unsubscribe().
        var entry = { listener };
        listeners.add(entry);
        return () => {
          listeners.delete(entry);
        };
      } }, { key: "beginGesture", value:

      function beginGesture() {
        host.beginGesture(this[_index]);
      } }, { key: "endGesture", value:

      function endGesture() {
        host.endGesture(this[_index]);
      } }]);}();


  var all = host.infos.map((raw, index) => new Parameter(index, describe(raw)));

  host.setListener((index, value) => {
    var listeners = subscribers.get(index);
    if (listeners === undefined || listeners.size === 0) return;
    var converted = fromHost(all[index].info, value);
    for (var { listener } of [...listeners]) {
      try {
        listener(converted);
      } catch (error) {
        host.reportError(error);
      }
    }
  });

  var parameters = exports.parameters = Object.freeze(
    Object.fromEntries(all.map((parameter) => [parameter.id, parameter]))
  );});
// Generated from native/src/modules/parameters/parameters.js by scripts/native-modules.mjs. Do not edit.
