(function (exports, require, module) {"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.Response = exports.Request = exports.Headers = void 0;exports.fetch = fetch;





  var _platform = require("soundor:internal/platform");
  var _blob2 = require("soundor:internal/web/blob");
  var _encoding = require("soundor:internal/web/encoding");




  var _formData2 = require("soundor:internal/web/form-data");
  var _url3 = require("soundor:internal/web/url");var _Response;function _inherits(t, e) {if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function");t.prototype = Object.create(e && e.prototype, { constructor: { value: t, writable: !0, configurable: !0 } }), Object.defineProperty(t, "prototype", { writable: !1 }), e && _setPrototypeOf(t, e);}function _setPrototypeOf(t, e) {return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (t, e) {return t.__proto__ = e, t;}, _setPrototypeOf(t, e);}function _callSuper(t, o, e) {return o = _getPrototypeOf(o), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e));}function _possibleConstructorReturn(t, e) {if (e && ("object" == typeof e || "function" == typeof e)) return e;if (void 0 !== e) throw new TypeError("Derived constructors may only return object or undefined");return _assertThisInitialized(t);}function _assertThisInitialized(e) {if (void 0 === e) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e;}function _isNativeReflectConstruct() {try {var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {}));} catch (t) {}return (_isNativeReflectConstruct = function () {return !!t;})();}function _getPrototypeOf(t) {return _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function (t) {return t.__proto__ || Object.getPrototypeOf(t);}, _getPrototypeOf(t);}function asyncGeneratorStep(n, t, e, r, o, a, c) {try {var i = n[a](c),u = i.value;} catch (n) {return void e(n);}i.done ? t(u) : Promise.resolve(u).then(r, o);}function _asyncToGenerator(n) {return function () {var t = this,e = arguments;return new Promise(function (r, o) {var a = n.apply(t, e);function _next(n) {asyncGeneratorStep(a, r, o, _next, _throw, "next", n);}function _throw(n) {asyncGeneratorStep(a, r, o, _next, _throw, "throw", n);}_next(void 0);});};}function _classCallCheck(a, n) {if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");}function _defineProperties(e, r) {for (var t = 0; t < r.length; t++) {var o = r[t];o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o);}}function _createClass(e, r, t) {return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e;}function _toPropertyKey(t) {var i = _toPrimitive(t, "string");return "symbol" == typeof i ? i : i + "";}function _toPrimitive(t, e) {if ("object" != typeof t || !t) return t;var r;if ("undefined" != typeof Symbol && void 0 !== (r = t[Symbol.toPrimitive])) {var i = r.call(t, e || "default");if ("object" != typeof i) return i;throw new TypeError("@@toPrimitive must return a primitive value.");}return ("string" === e ? String : Number)(t);}function _classPrivateFieldLooseBase(e, t) {if (!{}.hasOwnProperty.call(e, t)) throw new TypeError("attempted to use private field on non-instance");return e;} // fetch(), Headers, Request and Response over the backend's HTTP client.
  //
  // Bodies are buffered: Soundor has no Web Streams yet, so `body` streams are
  // not provided and bodies are read with arrayBuffer()/bytes()/text()/json()/
  // blob()/formData(). Requests always follow redirects.
  var encoder = new _encoding.TextEncoder(); // Private-state hooks, assigned by the classes' static blocks.
  var headerList;var bodyBytes;
  var setBodyBytes;
  var isUsed;
  var fromNetwork;

  // ── Headers ──────────────────────────────────────────────────────────────────

  var TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

  function headerName(name) {
    var text = String(name);
    if (!TOKEN.test(text)) throw new TypeError(`Invalid header name: '${text}'`);
    return text.toLowerCase();
  }

  function headerValue(value) {
    var text = String(value).replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, '');
    if (/[\u0000\r\n]/.test(text))
    throw new TypeError('Header values cannot contain NUL, CR or LF');
    return text;
  }var _list = Symbol("list");var

  Headers = exports.Headers = /*#__PURE__*/function () {


    function Headers(init = undefined) {_classCallCheck(this, Headers);Object.defineProperty(this, _list, { writable: true, value: [] });
      if (init === undefined || init === null) return;
      if (init instanceof Headers) {
        this[_list] = init[_list].map(([name, value]) => [name, value]);
      } else if (typeof init[Symbol.iterator] === 'function') {
        for (var pair of init) {
          var entry = [...pair];
          if (entry.length !== 2)
          throw new TypeError('Header pairs must have exactly two items');
          this.append(entry[0], entry[1]);
        }
      } else if (typeof init === 'object') {
        for (var key of Object.keys(init)) this.append(key, init[key]);
      } else {
        throw new TypeError('Headers expects pairs or a record');
      }
    }return _createClass(Headers, [{ key: "append", value:

      function append(name, value) {
        this[_list].push([headerName(name), headerValue(value)]);
      } }, { key: "delete", value:

      function _delete(name) {
        var key = headerName(name);
        this[_list] = this[_list].filter(([n]) => n !== key);
      } }, { key: "get", value:

      function get(name) {
        var key = headerName(name);
        var values = this[_list].filter(([n]) => n === key).map(([, v]) => v);
        return values.length === 0 ? null : values.join(', ');
      } }, { key: "getSetCookie", value:

      function getSetCookie() {
        return this[_list].filter(([n]) => n === 'set-cookie').map(([, v]) => v);
      } }, { key: "has", value:

      function has(name) {
        var key = headerName(name);
        return this[_list].some(([n]) => n === key);
      } }, { key: "set", value:

      function set(name, value) {
        var key = headerName(name);
        var entry = [key, headerValue(value)];
        var index = this[_list].findIndex(([n]) => n === key);
        if (index < 0) {
          this[_list].push(entry);
        } else {
          this[_list][index] = entry;
          this[_list] = this[_list].filter(([n], i) => n !== key || i <= index);
        }
      }

      /** Sorted and combined, with Set-Cookie kept separate (Fetch "sort and combine"). */ }, { key: "entries", value:
      function* entries() {
        var names = [...new Set(this[_list].map(([n]) => n))].sort();
        for (var name of names) {
          if (name === 'set-cookie') {
            for (var value of this.getSetCookie()) yield [name, value];
          } else {
            yield [name, this.get(name)];
          }
        }
      } }, { key: "keys", value:

      function* keys() {
        for (var [name] of this.entries()) yield name;
      } }, { key: "values", value:

      function* values() {
        for (var [, value] of this.entries()) yield value;
      } }, { key: "forEach", value:

      function forEach(callback, thisArg = undefined) {
        for (var [name, value] of this.entries())
        callback.call(thisArg, value, name, this);
      } }, { key:

      Symbol.iterator, value: function () {
        return this.entries();
      } }]);}();







  // ── Bodies ───────────────────────────────────────────────────────────────────
  headerList = (headers) => headers[_list].map(([name, value]) => [name, value]);
  function escapeQuoted(text) {
    return text.
    replaceAll('"', '%22').
    replaceAll('\r', '%0D').
    replaceAll('\n', '%0A');
  }

  function multipart(formData) {
    var random = new Uint8Array(12);
    crypto.getRandomValues(random);
    var boundary = `----SoundorFormBoundary${Array.from(random, (b) => b.toString(16).padStart(2, '0')).join('')}`;
    var parts = [];
    for (var [name, value] of formData) {
      var head = `--${boundary}\r\nContent-Disposition: form-data; name="${escapeQuoted(name)}"`;
      if (value instanceof _blob2.File) {
        head += `; filename="${escapeQuoted(value.name)}"\r\nContent-Type: ${value.type || 'application/octet-stream'}`;
        parts.push(head, '\r\n\r\n', value, '\r\n');
      } else {
        parts.push(
          head,
          '\r\n\r\n',
          value.replace(/\r\n|\r|\n/g, '\r\n'),
          '\r\n'
        );
      }
    }
    parts.push(`--${boundary}--\r\n`);
    return {
      bytes: (0, _blob2.blobBytes)(new _blob2.Blob(parts)),
      type: `multipart/form-data; boundary=${boundary}`
    };
  }

  /** Bytes and default Content-Type of a body init (Fetch "extract a body"). */
  function extractBody(body) {
    if (body === null || body === undefined) return { bytes: null, type: null };
    if (typeof body === 'string') {
      return { bytes: encoder.encode(body), type: 'text/plain;charset=UTF-8' };
    }
    if (body instanceof _url3.URLSearchParams) {
      return {
        bytes: encoder.encode(body.toString()),
        type: 'application/x-www-form-urlencoded;charset=UTF-8'
      };
    }
    if (body instanceof _blob2.Blob)
    return { bytes: (0, _blob2.blobBytes)(body), type: body.type || null };
    if (body instanceof _formData2.FormData) return multipart(body);
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
      return { bytes: (0, _encoding.bytesOf)(body).slice(), type: null };
    }
    if (
    typeof body?.[Symbol.asyncIterator] === 'function' ||
    typeof body?.getReader === 'function')
    {
      throw new TypeError(
        'Streaming bodies are not supported; pass the data as a whole'
      );
    }
    return {
      bytes: encoder.encode(String(body)),
      type: 'text/plain;charset=UTF-8'
    };
  }

  /** The shared body-reading methods of Request and Response. */var _bytes = Symbol("bytes");var _used = Symbol("used");var _consume = Symbol("consume");var
  Body = /*#__PURE__*/function () {



    function Body(bytes) {_classCallCheck(this, Body);Object.defineProperty(this, _consume, { value: _consume2 });Object.defineProperty(this, _bytes, { writable: true, value: void 0 });Object.defineProperty(this, _used, { writable: true, value: false });
      this[_bytes] = bytes;
    }return _createClass(Body, [{ key: "bodyUsed", get:

      function () {
        return this[_used];
      } }, { key: "arrayBuffer", value: function () {var _arrayBuffer = _asyncToGenerator(







          function* () {
            return this[_consume]().slice().buffer;
          });function arrayBuffer() {return _arrayBuffer.apply(this, arguments);}return arrayBuffer;}() }, { key: "bytes", value: function () {var _bytes2 = _asyncToGenerator(

          function* () {
            return this[_consume]().slice();
          });function bytes() {return _bytes2.apply(this, arguments);}return bytes;}() }, { key: "text", value: function () {var _text = _asyncToGenerator(

          function* () {
            return new _encoding.TextDecoder().decode(this[_consume]());
          });function text() {return _text.apply(this, arguments);}return text;}() }, { key: "json", value: function () {var _json = _asyncToGenerator(

          function* () {
            return JSON.parse(yield this.text());
          });function json() {return _json.apply(this, arguments);}return json;}() }, { key: "blob", value: function () {var _blob = _asyncToGenerator(

          function* () {
            return new _blob2.Blob([this[_consume]()], {
              type: this.headers.get('content-type') ?? ''
            });
          });function blob() {return _blob.apply(this, arguments);}return blob;}() }, { key: "formData", value: function () {var _formData = _asyncToGenerator(

          function* () {
            var type = this.headers.get('content-type') ?? '';
            if (!type.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
              throw new TypeError(
                'formData() supports application/x-www-form-urlencoded bodies only'
              );
            }
            var form = new _formData2.FormData();
            for (var [name, value] of new _url3.URLSearchParams(yield this.text()))
            form.append(name, value);
            return form;
          });function formData() {return _formData.apply(this, arguments);}return formData;}() }]);}();










  // ── Request ──────────────────────────────────────────────────────────────────
  function _consume2() {if (this[_used]) throw new TypeError('Body has already been consumed');this[_used] = true;return this[_bytes] ?? new Uint8Array(0);}(() => {bodyBytes = (body) => body[_bytes];setBodyBytes = (body, bytes) => {body[_bytes] = bytes;};isUsed = (body) => body[_used];})();
  var STANDARD_METHODS = [
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'POST',
  'PUT',
  'PATCH'];

  var FORBIDDEN_METHODS = ['CONNECT', 'TRACE', 'TRACK'];

  function normalizeMethod(method) {
    var text = String(method);
    if (!TOKEN.test(text)) throw new TypeError(`Invalid method: '${text}'`);
    var upper = text.toUpperCase();
    if (FORBIDDEN_METHODS.includes(upper))
    throw new TypeError(`Method ${upper} is forbidden`);
    return STANDARD_METHODS.includes(upper) ? upper : text;
  }var _method = Symbol("method");var _url = Symbol("url");var _headers = Symbol("headers");var _signal = Symbol("signal");var _redirect = Symbol("redirect");var

  Request = exports.Request = /*#__PURE__*/function (_Body2) {






    function Request(input, init = {}) {var _this;_classCallCheck(this, Request);
      var source = input instanceof Request ? input : null;
      if (source?.bodyUsed)
      throw new TypeError('Cannot construct a Request from a used Request');
      var url = _url3.URL.parse(source ? source.url : String(input));
      if (url === null) throw new TypeError(`Invalid URL: ${String(input)}`);
      if (url.username !== '' || url.password !== '') {
        throw new TypeError('Request URLs cannot contain credentials');
      }
      var method = normalizeMethod(init.method ?? source?.method ?? 'GET');
      var headers = new Headers(init.headers ?? source?.headers);
      var body =
      init.body !== undefined ?
      extractBody(init.body) :
      { bytes: source ? bodyBytes(source) : null, type: null };
      if (body.bytes !== null && (method === 'GET' || method === 'HEAD')) {
        throw new TypeError(`A ${method} request cannot have a body`);
      }
      if (body.type !== null && !headers.has('content-type'))
      headers.set('content-type', body.type);
      _this = _callSuper(this, Request, [body.bytes]);Object.defineProperty(_this, _method, { writable: true, value: void 0 });Object.defineProperty(_this, _url, { writable: true, value: void 0 });Object.defineProperty(_this, _headers, { writable: true, value: void 0 });Object.defineProperty(_this, _signal, { writable: true, value: void 0 });Object.defineProperty(_this, _redirect, { writable: true, value: void 0 });

      var redirect = init.redirect ?? source?.redirect ?? 'follow';
      if (!['follow', 'error', 'manual'].includes(redirect)) {
        throw new TypeError(`Invalid redirect mode: '${redirect}'`);
      }
      _this[_method] = method;
      _this[_url] = url.href;
      _this[_headers] = headers;
      _this[_redirect] = redirect;
      var controller = new AbortController();
      var parent = init.signal === undefined ? source?.signal : init.signal;
      if (parent) {
        if (parent.aborted) controller.abort(parent.reason);else

        parent.addEventListener(
          'abort',
          () => controller.abort(parent.reason),
          { once: true }
        );
      }
      _this[_signal] = controller.signal;return _this;
    }_inherits(Request, _Body2);return _createClass(Request, [{ key: "method", get:

      function () {
        return this[_method];
      } }, { key: "url", get:
      function () {
        return this[_url];
      } }, { key: "headers", get:
      function () {
        return this[_headers];
      } }, { key: "signal", get:
      function () {
        return this[_signal];
      } }, { key: "redirect", get:
      function () {
        return this[_redirect];
      } }, { key: "clone", value:

      function clone() {
        if (this.bodyUsed) throw new TypeError('Cannot clone a used Request');
        return new Request(this);
      } }]);}(Body);


  // ── Response ─────────────────────────────────────────────────────────────────

  var NULL_BODY_STATUSES = [101, 103, 204, 205, 304];
  var REDIRECT_STATUSES = [301, 302, 303, 307, 308];var _status = Symbol("status");var _statusText = Symbol("statusText");var _headers2 = Symbol("headers");var _url2 = Symbol("url");var _redirected = Symbol("redirected");var _type = Symbol("type");var

  Response = exports.Response = /*#__PURE__*/function (_Body3) {







    function Response(body = null, init = {}) {var _this2;_classCallCheck(this, Response);
      var status = init.status ?? 200;
      if (!Number.isInteger(status) || status < 200 || status > 599) {
        throw new RangeError(
          `Response status must be an integer from 200 to 599, got ${status}`
        );
      }
      var statusText = String(init.statusText ?? '');
      if (/[^\t\x20-\x7E\x80-\xFF]/.test(statusText))
      throw new TypeError('Invalid statusText');
      var extracted = extractBody(body);
      if (extracted.bytes !== null && NULL_BODY_STATUSES.includes(status)) {
        throw new TypeError(
          `A response with status ${status} cannot have a body`
        );
      }
      var headers = new Headers(init.headers);
      if (extracted.type !== null && !headers.has('content-type')) {
        headers.set('content-type', extracted.type);
      }
      _this2 = _callSuper(this, Response, [extracted.bytes]);Object.defineProperty(_this2, _status, { writable: true, value: void 0 });Object.defineProperty(_this2, _statusText, { writable: true, value: void 0 });Object.defineProperty(_this2, _headers2, { writable: true, value: void 0 });Object.defineProperty(_this2, _url2, { writable: true, value: '' });Object.defineProperty(_this2, _redirected, { writable: true, value: false });Object.defineProperty(_this2, _type, { writable: true, value: 'default' });
      _this2[_status] = status;
      _this2[_statusText] = statusText;
      _this2[_headers2] = headers;return _this2;
    }_inherits(Response, _Body3);return _createClass(Response, [{ key: "status", get:

      function () {
        return this[_status];
      } }, { key: "statusText", get:
      function () {
        return this[_statusText];
      } }, { key: "ok", get:
      function () {
        return this[_status] >= 200 && this[_status] <= 299;
      } }, { key: "headers", get:
      function () {
        return this[_headers2];
      } }, { key: "url", get:
      function () {
        return this[_url2];
      } }, { key: "redirected", get:
      function () {
        return this[_redirected];
      } }, { key: "type", get:
      function () {
        return this[_type];
      } }, { key: "clone", value:

      function clone() {
        if (this.bodyUsed) throw new TypeError('Cannot clone a used Response');
        return fromNetwork({
          status: this[_status],
          statusText: this[_statusText],
          headers: headerList(this[_headers2]),
          body: bodyBytes(this),
          url: this[_url2],
          redirected: this[_redirected],
          type: this[_type]
        });
      } }], [{ key: "error", value:

      function error() {
        var response = new Response(null, { status: 200 });
        response[_status] = 0;
        response[_type] = 'error';
        return response;
      } }, { key: "json", value:

      function json(data, init = {}) {
        var text = JSON.stringify(data);
        if (text === undefined)
        throw new TypeError('The value cannot be serialized as JSON');
        var headers = new Headers(init.headers);
        if (!headers.has('content-type'))
        headers.set('content-type', 'application/json');
        return new Response(text, { ...init, headers });
      } }, { key: "redirect", value:

      function redirect(url, status = 302) {
        if (!REDIRECT_STATUSES.includes(status))
        throw new RangeError(`Invalid redirect status ${status}`);
        return new Response(null, {
          status,
          headers: { location: new _url3.URL(url).href }
        });
      } }]);}(Body);



















  // ── fetch() ──────────────────────────────────────────────────────────────────
  _Response = Response;fromNetwork = (parts) => {// Network responses may carry statuses the constructor rejects (1xx).
    var response = new _Response(null, { status: 200, headers: parts.headers });response[_status] = parts.status;response[_statusText] = parts.statusText;response[_url2] = parts.url;response[_redirected] = parts.redirected;response[_type] = parts.type ?? 'basic';setBodyBytes(response, parts.body);return response;};function decodeDataUrl(url) {
    var comma = url.pathname.indexOf(',');
    if (comma < 0) throw new TypeError('Invalid data: URL');
    var header = url.pathname.slice(0, comma);
    var payload = decodeURIComponent(
      url.pathname.slice(comma + 1) + url.search
    );
    var isBase64 = /;base64$/i.test(header);
    var type =
    (isBase64 ? header.slice(0, -7) : header) || 'text/plain;charset=US-ASCII';
    var bytes = isBase64 ?
    Uint8Array.from(atob(payload.replace(/\s+/g, '')), (c) => c.charCodeAt(0)) :
    encoder.encode(payload);
    return fromNetwork({
      status: 200,
      statusText: 'OK',
      headers: [['content-type', type]],
      body: bytes,
      url: url.href,
      redirected: false
    });
  }

  function fetch(input, init = {}) {
    return new Promise((resolve, reject) => {
      var request = new Request(input, init);
      var { signal } = request;
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      var url = new _url3.URL(request.url);
      if (url.protocol === 'data:') {
        resolve(decodeDataUrl(url));
        return;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        reject(new TypeError(`fetch() does not support ${url.protocol} URLs`));
        return;
      }
      if (request.redirect !== 'follow') {
        reject(
          new TypeError(`Redirect mode '${request.redirect}' is not supported`)
        );
        return;
      }
      if (isUsed(request)) {
        reject(new TypeError('The request body has already been consumed'));
        return;
      }
      var [response, id] = (0, _platform.httpSend)(
        request.method,
        request.url,
        headerList(request.headers),
        bodyBytes(request)
      );
      var onAbort = () => {
        (0, _platform.httpAbort)(id);
        reject(signal.reason);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      response.then(
        (parts) => {
          signal.removeEventListener('abort', onAbort);
          try {
            resolve(
              fromNetwork({
                ...parts,
                redirected: parts.url !== '' && parts.url !== request.url
              })
            );
          } catch (error) {
            reject(
              new TypeError(`fetch failed: invalid response (${error.message})`)
            );
          }
        },
        (error) => {
          signal.removeEventListener('abort', onAbort);
          if (!signal.aborted) reject(error);
        }
      );
    });
  }});
// Generated from native/src/web/js/fetch.js by scripts/native-modules.mjs. Do not edit.
