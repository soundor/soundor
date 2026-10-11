(function (exports, require, module) {"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.blobBytes = exports.File = exports.Blob = void 0;


  var _clone = require("soundor:internal/web/clone");
  var _encoding = require("soundor:internal/web/encoding");function _inherits(t, e) {if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function");t.prototype = Object.create(e && e.prototype, { constructor: { value: t, writable: !0, configurable: !0 } }), Object.defineProperty(t, "prototype", { writable: !1 }), e && _setPrototypeOf(t, e);}function _setPrototypeOf(t, e) {return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (t, e) {return t.__proto__ = e, t;}, _setPrototypeOf(t, e);}function _callSuper(t, o, e) {return o = _getPrototypeOf(o), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e));}function _possibleConstructorReturn(t, e) {if (e && ("object" == typeof e || "function" == typeof e)) return e;if (void 0 !== e) throw new TypeError("Derived constructors may only return object or undefined");return _assertThisInitialized(t);}function _assertThisInitialized(e) {if (void 0 === e) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e;}function _isNativeReflectConstruct() {try {var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {}));} catch (t) {}return (_isNativeReflectConstruct = function () {return !!t;})();}function _getPrototypeOf(t) {return _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function (t) {return t.__proto__ || Object.getPrototypeOf(t);}, _getPrototypeOf(t);}function asyncGeneratorStep(n, t, e, r, o, a, c) {try {var i = n[a](c),u = i.value;} catch (n) {return void e(n);}i.done ? t(u) : Promise.resolve(u).then(r, o);}function _asyncToGenerator(n) {return function () {var t = this,e = arguments;return new Promise(function (r, o) {var a = n.apply(t, e);function _next(n) {asyncGeneratorStep(a, r, o, _next, _throw, "next", n);}function _throw(n) {asyncGeneratorStep(a, r, o, _next, _throw, "throw", n);}_next(void 0);});};}function _classCallCheck(a, n) {if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");}function _defineProperties(e, r) {for (var t = 0; t < r.length; t++) {var o = r[t];o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o);}}function _createClass(e, r, t) {return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e;}function _toPropertyKey(t) {var i = _toPrimitive(t, "string");return "symbol" == typeof i ? i : i + "";}function _toPrimitive(t, e) {if ("object" != typeof t || !t) return t;var r;if ("undefined" != typeof Symbol && void 0 !== (r = t[Symbol.toPrimitive])) {var i = r.call(t, e || "default");if ("object" != typeof i) return i;throw new TypeError("@@toPrimitive must return a primitive value.");}return ("string" === e ? String : Number)(t);}function _classPrivateFieldLooseBase(e, t) {if (!{}.hasOwnProperty.call(e, t)) throw new TypeError("attempted to use private field on non-instance");return e;} // Blob and File: immutable bytes with a MIME type. stream() is not provided
  // (Soundor has no Web Streams yet).




  var encoder = new _encoding.TextEncoder();

  /** The bytes behind a Blob, for fetch bodies and FormData (not public). */
  var blobBytes;

  function normalizeType(type) {
    var text = String(type ?? '');
    return /^[\x20-\x7E]*$/.test(text) ? text.toLowerCase() : '';
  }

  function partBytes(part) {
    if (part instanceof Blob) return blobBytes(part);
    if (part instanceof ArrayBuffer || ArrayBuffer.isView(part))
    return (0, _encoding.bytesOf)(part);
    return encoder.encode(String(part));
  }var _bytes = Symbol("bytes");var _type = Symbol("type");var

  Blob = exports.Blob = /*#__PURE__*/function () {



    function Blob(parts = [], options = {}) {_classCallCheck(this, Blob);Object.defineProperty(this, _bytes, { writable: true, value: void 0 });Object.defineProperty(this, _type, { writable: true, value: void 0 });
      if (
      typeof parts !== 'object' ||
      parts === null ||
      typeof parts[Symbol.iterator] !== 'function')
      {
        throw new TypeError('Blob parts must be an iterable');
      }
      var chunks = [...parts].map(partBytes);
      var size = chunks.reduce((total, chunk) => total + chunk.length, 0);
      var bytes = new Uint8Array(size);
      var offset = 0;
      for (var chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      this[_bytes] = bytes;
      this[_type] = normalizeType(options?.type);
    }return _createClass(Blob, [{ key: "size", get:





      function () {
        return this[_bytes].length;
      } }, { key: "type", get:
      function () {
        return this[_type];
      } }, { key: "slice", value:

      function slice(start = 0, end = this.size, contentType = '') {
        var clamp = (index) =>
        index < 0 ? Math.max(this.size + index, 0) : Math.min(index, this.size);
        var from = clamp(Math.trunc(Number(start)) || 0);
        var to = clamp(Math.trunc(Number(end)) || 0);
        return new Blob([this[_bytes].subarray(from, Math.max(from, to))], {
          type: contentType
        });
      } }, { key: "arrayBuffer", value: function () {var _arrayBuffer = _asyncToGenerator(

          function* () {
            return this[_bytes].slice().buffer;
          });function arrayBuffer() {return _arrayBuffer.apply(this, arguments);}return arrayBuffer;}() }, { key: "bytes", value: function () {var _bytes2 = _asyncToGenerator(

          function* () {
            return this[_bytes].slice();
          });function bytes() {return _bytes2.apply(this, arguments);}return bytes;}() }, { key: "text", value: function () {var _text = _asyncToGenerator(

          function* () {
            return new _encoding.TextDecoder().decode(this[_bytes]);
          });function text() {return _text.apply(this, arguments);}return text;}() }, { key:

      Symbol.toStringTag, get: function () {
        return 'Blob';
      } }]);}();exports.blobBytes = blobBytes = (blob) => blob[_bytes];var _name = Symbol("name");var _lastModified = Symbol("lastModified");var


  File = exports.File = /*#__PURE__*/function (_Blob2) {



    function File(bits, name, options = {}) {var _this;_classCallCheck(this, File);
      if (arguments.length < 2)
      throw new TypeError('File requires bits and a name');
      _this = _callSuper(this, File, [bits, options]);Object.defineProperty(_this, _name, { writable: true, value: void 0 });Object.defineProperty(_this, _lastModified, { writable: true, value: void 0 });
      _this[_name] = String(name);
      _this[_lastModified] =
      options?.lastModified === undefined ?
      Date.now() :
      Number(options.lastModified);return _this;
    }_inherits(File, _Blob2);return _createClass(File, [{ key: "name", get:

      function () {
        return this[_name];
      } }, { key: "lastModified", get:
      function () {
        return this[_lastModified];
      } }, { key:

      Symbol.toStringTag, get: function () {
        return 'File';
      } }]);}(Blob);


  // File before Blob: clone checks in registration order.
  (0, _clone.registerCloneable)(
    File,
    (file) =>
    new File([file], file.name, {
      type: file.type,
      lastModified: file.lastModified
    })
  );
  (0, _clone.registerCloneable)(Blob, (blob) => blob.slice(0, blob.size, blob.type));});
// Generated from native/src/web/js/blob.js by scripts/native-modules.mjs. Do not edit.
