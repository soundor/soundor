(function (exports, require, module) {"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.TextEncoder = exports.TextDecoder = void 0;exports.bytesOf = bytesOf;


  var _platform = require("soundor:internal/platform");function _classPrivateFieldLooseBase(e, t) {if (!{}.hasOwnProperty.call(e, t)) throw new TypeError("attempted to use private field on non-instance");return e;}function _classCallCheck(a, n) {if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");}function _defineProperties(e, r) {for (var t = 0; t < r.length; t++) {var o = r[t];o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o);}}function _createClass(e, r, t) {return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e;}function _toPropertyKey(t) {var i = _toPrimitive(t, "string");return "symbol" == typeof i ? i : i + "";}function _toPrimitive(t, e) {if ("object" != typeof t || !t) return t;var r;if ("undefined" != typeof Symbol && void 0 !== (r = t[Symbol.toPrimitive])) {var i = r.call(t, e || "default");if ("object" != typeof i) return i;throw new TypeError("@@toPrimitive must return a primitive value.");}return ("string" === e ? String : Number)(t);} // TextEncoder and TextDecoder (UTF-8, as the Encoding Standard requires of
  // TextEncoder; TextDecoder supports the UTF-8 labels).




  var UTF8_LABELS = new Set([
  'unicode-1-1-utf-8',
  'unicode11utf8',
  'unicode20utf8',
  'utf-8',
  'utf8',
  'x-unicode20utf8']
  );var

  TextEncoder = exports.TextEncoder = /*#__PURE__*/function () {function TextEncoder() {_classCallCheck(this, TextEncoder);}return _createClass(TextEncoder, [{ key: "encoding", get:
      function () {
        return 'utf-8';
      } }, { key: "encode", value:

      function encode(input = '') {
        return (0, _platform.encodeUtf8)(String(input));
      } }, { key: "encodeInto", value:

      function encodeInto(source, destination) {
        if (!(destination instanceof Uint8Array)) {
          throw new TypeError('encodeInto() expects a Uint8Array destination');
        }
        var [read, written] = (0, _platform.encodeUtf8Into)(String(source), destination);
        return { read, written };
      } }]);}();


  /** A Uint8Array over any BufferSource, without copying. */
  function bytesOf(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    throw new TypeError('Expected an ArrayBuffer or an ArrayBuffer view');
  }var _fatal = Symbol("fatal");var _ignoreBOM = Symbol("ignoreBOM");var _pending = Symbol("pending");var _bomSeen = Symbol("bomSeen");var _reset = Symbol("reset");var

  TextDecoder = exports.TextDecoder = /*#__PURE__*/function () {





    function TextDecoder(label = 'utf-8', options = {}) {_classCallCheck(this, TextDecoder);Object.defineProperty(this, _reset, { value: _reset2 });Object.defineProperty(this, _fatal, { writable: true, value: void 0 });Object.defineProperty(this, _ignoreBOM, { writable: true, value: void 0 });Object.defineProperty(this, _pending, { writable: true, value: new Uint8Array(0) });Object.defineProperty(this, _bomSeen, { writable: true, value: false });
      var normalized = String(label).trim().toLowerCase();
      if (!UTF8_LABELS.has(normalized)) {
        throw new RangeError(
          `The encoding label '${label}' is not supported; Soundor decodes UTF-8 only`
        );
      }
      this[_fatal] = Boolean(options?.fatal);
      this[_ignoreBOM] = Boolean(options?.ignoreBOM);
    }return _createClass(TextDecoder, [{ key: "encoding", get:

      function () {
        return 'utf-8';
      } }, { key: "fatal", get:
      function () {
        return this[_fatal];
      } }, { key: "ignoreBOM", get:
      function () {
        return this[_ignoreBOM];
      } }, { key: "decode", value:

      function decode(input, options = {}) {
        var stream = Boolean(options?.stream);
        var bytes = input === undefined ? new Uint8Array(0) : bytesOf(input);
        if (this[_pending].length > 0) {
          var joined = new Uint8Array(this[_pending].length + bytes.length);
          joined.set(this[_pending]);
          joined.set(bytes, this[_pending].length);
          bytes = joined;
        }
        var text;
        var consumed;
        try {
          [text, consumed] = (0, _platform.decodeUtf8)(bytes, this[_fatal], !stream);
        } catch (error) {
          this[_reset]();
          throw error;
        }
        this[_pending] = bytes.slice(consumed);
        if (!this[_ignoreBOM] && !this[_bomSeen] && text.length > 0) {
          this[_bomSeen] = true;
          if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
        }
        if (!stream) this[_reset]();
        return text;
      } }]);}();function _reset2()

  {
    this[_pending] = new Uint8Array(0);
    this[_bomSeen] = false;
  }});
// Generated from native/src/web/js/encoding.js by scripts/native-modules.mjs. Do not edit.
