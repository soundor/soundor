(function (exports, require, module) {"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.AbortSignal = exports.AbortController = void 0;

  var _events = require("soundor:internal/web/events");
  var _timers = require("soundor:internal/web/timers");function _classCallCheck(a, n) {if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");}function _defineProperties(e, r) {for (var t = 0; t < r.length; t++) {var o = r[t];o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o);}}function _createClass(e, r, t) {return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e;}function _toPropertyKey(t) {var i = _toPrimitive(t, "string");return "symbol" == typeof i ? i : i + "";}function _toPrimitive(t, e) {if ("object" != typeof t || !t) return t;var r;if ("undefined" != typeof Symbol && void 0 !== (r = t[Symbol.toPrimitive])) {var i = r.call(t, e || "default");if ("object" != typeof i) return i;throw new TypeError("@@toPrimitive must return a primitive value.");}return ("string" === e ? String : Number)(t);}function _inherits(t, e) {if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function");t.prototype = Object.create(e && e.prototype, { constructor: { value: t, writable: !0, configurable: !0 } }), Object.defineProperty(t, "prototype", { writable: !1 }), e && _setPrototypeOf(t, e);}function _setPrototypeOf(t, e) {return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (t, e) {return t.__proto__ = e, t;}, _setPrototypeOf(t, e);}function _callSuper(t, o, e) {return o = _getPrototypeOf(o), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e));}function _possibleConstructorReturn(t, e) {if (e && ("object" == typeof e || "function" == typeof e)) return e;if (void 0 !== e) throw new TypeError("Derived constructors may only return object or undefined");return _assertThisInitialized(t);}function _assertThisInitialized(e) {if (void 0 === e) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e;}function _isNativeReflectConstruct() {try {var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {}));} catch (t) {}return (_isNativeReflectConstruct = function () {return !!t;})();}function _getPrototypeOf(t) {return _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function (t) {return t.__proto__ || Object.getPrototypeOf(t);}, _getPrototypeOf(t);}function _classPrivateFieldLooseBase(e, t) {if (!{}.hasOwnProperty.call(e, t)) throw new TypeError("attempted to use private field on non-instance");return e;} // AbortController and AbortSignal.

  var creating = false;
  /** Aborts a signal from AbortController without a public method. */
  var abortSignal;var _aborted = Symbol("aborted");var _reason = Symbol("reason");var _onabort = Symbol("onabort");var _abort = Symbol("abort");var

  AbortSignal = exports.AbortSignal = /*#__PURE__*/function (_EventTarget) {




    function AbortSignal() {var _this;_classCallCheck(this, AbortSignal);
      if (!creating) throw new TypeError('Illegal constructor');
      _this = _callSuper(this, AbortSignal);Object.defineProperty(_this, _abort, { value: _abort2 });Object.defineProperty(_this, _aborted, { writable: true, value: false });Object.defineProperty(_this, _reason, { writable: true, value: undefined });Object.defineProperty(_this, _onabort, { writable: true, value: null });return _this;
    }_inherits(AbortSignal, _EventTarget);return _createClass(AbortSignal, [{ key: "aborted", get:

      function () {
        return this[_aborted];
      } }, { key: "reason", get:
      function () {
        return this[_reason];
      } }, { key: "onabort", get:

      function () {
        return this[_onabort];
      }, set:
      function (handler) {
        if (this[_onabort]) this.removeEventListener('abort', this[_onabort]);
        this[_onabort] = typeof handler === 'function' ? handler : null;
        if (this[_onabort]) this.addEventListener('abort', this[_onabort]);
      } }, { key: "throwIfAborted", value:

      function throwIfAborted() {
        if (this[_aborted]) throw this[_reason];
      } }], [{ key: "abort", value:

      function abort(reason) {
        var signal = createSignal();
        signal[_abort](reason);
        return signal;
      } }, { key: "timeout", value:

      function timeout(milliseconds) {
        var signal = createSignal();
        (0, _timers.setTimeout)(
          () =>
          signal[_abort](
            new DOMException('The operation timed out.', 'TimeoutError')),

          milliseconds
        );
        return signal;
      } }, { key: "any", value:

      function any(signals) {
        var signal = createSignal();
        var sources = [...signals];
        var aborted = sources.find((source) => source.aborted);
        if (aborted) {
          signal[_abort](aborted.reason);
          return signal;
        }
        var controller = new AbortController();var _loop = function (source)
        {
          source.addEventListener('abort', () => signal[_abort](source.reason), {
            once: true,
            signal: controller.signal
          });
        };for (var source of sources) {_loop(source);}
        signal.addEventListener('abort', () => controller.abort(), { once: true });
        return signal;
      } }]);}(_events.EventTarget);function _abort2(





  reason) {
    if (this[_aborted]) return;
    this[_aborted] = true;
    this[_reason] =
    reason === undefined ?
    new DOMException('This operation was aborted', 'AbortError') :
    reason;
    this.dispatchEvent(new _events.Event('abort'));
  }abortSignal = (signal, reason) => signal[_abort](reason);


  function createSignal() {
    creating = true;
    try {
      return new AbortSignal();
    } finally {
      creating = false;
    }
  }var _signal = Symbol("signal");var

  AbortController = exports.AbortController = /*#__PURE__*/function () {function AbortController() {_classCallCheck(this, AbortController);Object.defineProperty(this, _signal, { writable: true, value:
        createSignal() });}return _createClass(AbortController, [{ key: "signal", get:

      function () {
        return this[_signal];
      } }, { key: "abort", value:

      function abort(reason) {
        abortSignal(this[_signal], reason);
      } }]);}();});
// Generated from native/src/web/js/abort.js by scripts/native-modules.mjs. Do not edit.
