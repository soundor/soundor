(function (exports, require, module) {"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.DOMException = void 0;function _classCallCheck(a, n) {if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");}function _defineProperties(e, r) {for (var t = 0; t < r.length; t++) {var o = r[t];o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o);}}function _createClass(e, r, t) {return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e;}function _toPropertyKey(t) {var i = _toPrimitive(t, "string");return "symbol" == typeof i ? i : i + "";}function _toPrimitive(t, e) {if ("object" != typeof t || !t) return t;var r;if ("undefined" != typeof Symbol && void 0 !== (r = t[Symbol.toPrimitive])) {var i = r.call(t, e || "default");if ("object" != typeof i) return i;throw new TypeError("@@toPrimitive must return a primitive value.");}return ("string" === e ? String : Number)(t);}function _inherits(t, e) {if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function");t.prototype = Object.create(e && e.prototype, { constructor: { value: t, writable: !0, configurable: !0 } }), Object.defineProperty(t, "prototype", { writable: !1 }), e && _setPrototypeOf(t, e);}function _callSuper(t, o, e) {return o = _getPrototypeOf(o), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e));}function _possibleConstructorReturn(t, e) {if (e && ("object" == typeof e || "function" == typeof e)) return e;if (void 0 !== e) throw new TypeError("Derived constructors may only return object or undefined");return _assertThisInitialized(t);}function _assertThisInitialized(e) {if (void 0 === e) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e;}function _wrapNativeSuper(t) {var r = "function" == typeof Map ? new Map() : void 0;return _wrapNativeSuper = function (t) {if (null === t || !_isNativeFunction(t)) return t;if ("function" != typeof t) throw new TypeError("Super expression must either be null or a function");if (void 0 !== r) {if (r.has(t)) return r.get(t);r.set(t, Wrapper);}function Wrapper() {return _construct(t, arguments, _getPrototypeOf(this).constructor);}return Wrapper.prototype = Object.create(t.prototype, { constructor: { value: Wrapper, enumerable: !1, writable: !0, configurable: !0 } }), _setPrototypeOf(Wrapper, t);}, _wrapNativeSuper(t);}function _construct(t, e, r) {if (_isNativeReflectConstruct()) return Reflect.construct.apply(null, arguments);var o = [null];o.push.apply(o, e);var p = new (t.bind.apply(t, o))();return r && _setPrototypeOf(p, r.prototype), p;}function _isNativeReflectConstruct() {try {var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {}));} catch (t) {}return (_isNativeReflectConstruct = function () {return !!t;})();}function _isNativeFunction(t) {try {return -1 !== Function.toString.call(t).indexOf("[native code]");} catch (n) {return "function" == typeof t;}}function _setPrototypeOf(t, e) {return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (t, e) {return t.__proto__ = e, t;}, _setPrototypeOf(t, e);}function _getPrototypeOf(t) {return _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function (t) {return t.__proto__ || Object.getPrototypeOf(t);}, _getPrototypeOf(t);} // DOMException (WebIDL), which the Web APIs throw: an Error with a `name` from
  // the DOM's list and its legacy numeric `code`.

  var CODES = {
    IndexSizeError: 1,
    HierarchyRequestError: 3,
    WrongDocumentError: 4,
    InvalidCharacterError: 5,
    NoModificationAllowedError: 7,
    NotFoundError: 8,
    NotSupportedError: 9,
    InvalidStateError: 11,
    SyntaxError: 12,
    InvalidModificationError: 13,
    NamespaceError: 14,
    InvalidAccessError: 15,
    TypeMismatchError: 17,
    SecurityError: 18,
    NetworkError: 19,
    AbortError: 20,
    URLMismatchError: 21,
    QuotaExceededError: 22,
    TimeoutError: 23,
    InvalidNodeTypeError: 24,
    DataCloneError: 25
  };

  var CONSTANTS = {
    INDEX_SIZE_ERR: 1,
    DOMSTRING_SIZE_ERR: 2,
    HIERARCHY_REQUEST_ERR: 3,
    WRONG_DOCUMENT_ERR: 4,
    INVALID_CHARACTER_ERR: 5,
    NO_DATA_ALLOWED_ERR: 6,
    NO_MODIFICATION_ALLOWED_ERR: 7,
    NOT_FOUND_ERR: 8,
    NOT_SUPPORTED_ERR: 9,
    INUSE_ATTRIBUTE_ERR: 10,
    INVALID_STATE_ERR: 11,
    SYNTAX_ERR: 12,
    INVALID_MODIFICATION_ERR: 13,
    NAMESPACE_ERR: 14,
    INVALID_ACCESS_ERR: 15,
    VALIDATION_ERR: 16,
    TYPE_MISMATCH_ERR: 17,
    SECURITY_ERR: 18,
    NETWORK_ERR: 19,
    ABORT_ERR: 20,
    URL_MISMATCH_ERR: 21,
    QUOTA_EXCEEDED_ERR: 22,
    TIMEOUT_ERR: 23,
    INVALID_NODE_TYPE_ERR: 24,
    DATA_CLONE_ERR: 25
  };

  var NAME = Symbol('name');var

  DOMException = exports.DOMException = /*#__PURE__*/function (_Error) {
    function DOMException(message = '', name = 'Error') {var _this;_classCallCheck(this, DOMException);
      _this = _callSuper(this, DOMException, [String(message)]);
      Object.defineProperty(_this, NAME, { value: String(name) });return _this;
    }_inherits(DOMException, _Error);return _createClass(DOMException, [{ key: "name", get:

      function () {
        return this[NAME] ?? 'Error';
      } }, { key: "code", get:

      function () {
        return CODES[this[NAME]] ?? 0;
      } }]);}(/*#__PURE__*/_wrapNativeSuper(Error));


  for (var [constant, value] of Object.entries(CONSTANTS)) {
    var property = { value, enumerable: true };
    Object.defineProperty(DOMException, constant, property);
    Object.defineProperty(DOMException.prototype, constant, property);
  }

  Object.defineProperty(DOMException.prototype, Symbol.toStringTag, {
    value: 'DOMException',
    configurable: true
  });});
// Generated from native/src/web/js/dom-exception.js by scripts/native-modules.mjs. Do not edit.
