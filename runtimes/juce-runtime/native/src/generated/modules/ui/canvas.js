(function (exports, require, module) {"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.TextMetrics = exports.ImageData = exports.CanvasRenderingContext2D = exports.CanvasPattern = exports.CanvasGradient = void 0;exports.createContext2D = createContext2D;exports.resetContext = void 0;exports.resolveSource = resolveSource;exports.setSourceResolver = setSourceResolver;










  var native = _interopRequireWildcard(require("soundor:internal/ui"));var cache;function _interopRequireWildcard(e, t) {if (!t && e && e.__esModule) return e;var r,c,a = Object.defineProperty,n = { __proto__: null, default: e };if (Object(e) !== e) return n;if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) {if (cache.has(e)) return cache.get(e);cache.set(e, n);}for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]);return n;}function _classCallCheck(a, n) {if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");}function _defineProperties(e, r) {for (var t = 0; t < r.length; t++) {var o = r[t];o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o);}}function _createClass(e, r, t) {return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e;}function _toPropertyKey(t) {var i = _toPrimitive(t, "string");return "symbol" == typeof i ? i : i + "";}function _toPrimitive(t, e) {if ("object" != typeof t || !t) return t;var r;if ("undefined" != typeof Symbol && void 0 !== (r = t[Symbol.toPrimitive])) {var i = r.call(t, e || "default");if ("object" != typeof i) return i;throw new TypeError("@@toPrimitive must return a primitive value.");}return ("string" === e ? String : Number)(t);}function _classPrivateFieldLooseBase(e, t) {if (!{}.hasOwnProperty.call(e, t)) throw new TypeError("attempted to use private field on non-instance");return e;} // A canvas node's 2D context (CanvasRenderingContext2D), with ImageData,
  // CanvasGradient, CanvasPattern and TextMetrics, as on the Web.
  //
  // Embedded into the native runtime; part of soundor:ui. Drawing happens
  // natively (Skia, on the CPU) into the canvas's pixels: each method converts
  // its arguments the way WebIDL would, then makes one native call,
  // call2d(node, op, ...). Path commands are the exception: they draw nothing
  // by themselves, so they are gathered (in a Float64Array) and sent in one
  // call before whatever comes next. What Soundor does not implement throws a
  // TypeError saying so, rather than drawing something else.
  // The operations native code knows, by number (src/modules/ui/CanvasModule.h).
  var OP = { save: 0, restore: 1, reset: 2, globalAlpha: 3, setGlobalAlpha: 4, compositeOperation: 5, setCompositeOperation: 6, scale: 7,
    rotate: 8,
    translate: 9,
    transform: 10,
    setTransform: 11,
    resetTransform: 12,
    getTransform: 13,
    setFillColor: 14,
    setStrokeColor: 15,
    setFillPaint: 16,
    setStrokePaint: 17,
    fillColor: 18,
    strokeColor: 19,
    lineWidth: 20,
    setLineWidth: 21,
    lineCap: 22,
    setLineCap: 23,
    lineJoin: 24,
    setLineJoin: 25,
    miterLimit: 26,
    setMiterLimit: 27,
    lineDash: 28,
    setLineDash: 29,
    lineDashOffset: 30,
    setLineDashOffset: 31,
    clearRect: 32,
    fillRect: 33,
    strokeRect: 34,
    beginPath: 35,
    closePath: 36,
    moveTo: 37,
    lineTo: 38,
    quadraticCurveTo: 39,
    bezierCurveTo: 40,
    arcTo: 41,
    rect: 42,
    roundRect: 43,
    arc: 44,
    ellipse: 45,
    fill: 46,
    stroke: 47,
    clip: 48,
    isPointInPath: 49,
    isPointInStroke: 50,
    font: 51,
    setFont: 52,
    textAlign: 53,
    setTextAlign: 54,
    textBaseline: 55,
    setTextBaseline: 56,
    fillText: 57,
    strokeText: 58,
    measureText: 59,
    imageSmoothing: 60,
    setImageSmoothing: 61,
    drawCanvas: 62,
    drawAsset: 63,
    getImageData: 64,
    putImageData: 65,
    path: 66
  };

  /** At most this many numbers of path commands wait to be sent. */
  var PATH_LIMIT = 1 << 16;

  var CONSTRUCTING = Symbol('constructing');

  /** Gradients and patterns are native; they go when their objects do. */
  var paints = new FinalizationRegistry((id) => native.release2d(0, id));

  /**
   * The canvas was resized: its context went back to its defaults (black
   * styles, no path).
   */
  var resetContext;

  /** What a canvas source is, for drawImage() and createPattern(). */
  var sourceOf = () => null;

  /** Lets soundor:ui say which nodes are canvases and images. */
  function setSourceResolver(resolve) {
    sourceOf = resolve;
  }

  /** What a canvas source is ({ kind: 'canvas', id, … }), or null; for WebGL. */
  function resolveSource(value) {
    return sourceOf(value);
  }

  function number(value) {
    return Number(value);
  }

  function finite(...values) {
    return values.every((value) => Number.isFinite(value));
  }

  /**
   * Whether up to six numbers (already converted, so never undefined) are all
   * finite; for the path methods, which call it without making an array.
   */
  function finiteNumbers(a, b, c, d, e, f) {
    return (
      Number.isFinite(a) && (
      b === undefined || Number.isFinite(b)) && (
      c === undefined || Number.isFinite(c)) && (
      d === undefined || Number.isFinite(d)) && (
      e === undefined || Number.isFinite(e)) && (
      f === undefined || Number.isFinite(f)));

  }

  function unsupported(what) {
    return new TypeError(`${what} is not supported by Soundor's 2D canvas`);
  }

  function requireArguments(name, given, required) {
    if (given < required) {
      throw new TypeError(
        `Failed to execute '${name}' on 'CanvasRenderingContext2D': ${required} arguments required, but only ${given} present.`
      );
    }
  }

  function fillRule(value, name) {
    if (value === undefined || value === 'nonzero') return false;
    if (value === 'evenodd') return true;
    if (typeof value === 'object' && value !== null)
    throw unsupported(`${name}() with a Path2D`);
    throw new TypeError(
      `The provided value '${value}' is not a valid enum value of type CanvasFillRule.`
    );
  }var _id = Symbol("id");var

  CanvasGradient = exports.CanvasGradient = /*#__PURE__*/function () {


    function CanvasGradient(token, id) {_classCallCheck(this, CanvasGradient);Object.defineProperty(this, _id, { writable: true, value: void 0 });
      if (token !== CONSTRUCTING) throw new TypeError('Illegal constructor');
      this[_id] = id;
      paints.register(this, id);
    }return _createClass(CanvasGradient, [{ key: "addColorStop", value:

      function addColorStop(offset, color) {
        var at = number(offset);
        if (!Number.isFinite(at))
        throw new TypeError(
          "Failed to execute 'addColorStop' on 'CanvasGradient': The provided double value is non-finite."
        );
        if (at < 0 || at > 1)
        throw new DOMException(
          `The provided value (${at}) is outside the range (0.0, 1.0).`,
          'IndexSizeError'
        );
        if (!native.colorStop2d(this[_id], at, String(color)))
        throw new DOMException(
          `The value provided ('${color}') could not be parsed as a color.`,
          'SyntaxError'
        );
      } }], [{ key: "idOf", value:

      function idOf(gradient) {
        return gradient[_id];
      } }]);}();var _id2 = Symbol("id");var


  CanvasPattern = exports.CanvasPattern = /*#__PURE__*/function () {


    function CanvasPattern(token, id) {_classCallCheck(this, CanvasPattern);Object.defineProperty(this, _id2, { writable: true, value: void 0 });
      if (token !== CONSTRUCTING) throw new TypeError('Illegal constructor');
      this[_id2] = id;
      paints.register(this, id);
    }return _createClass(CanvasPattern, [{ key: "setTransform", value:

      function setTransform() {
        throw unsupported('CanvasPattern.setTransform()');
      } }], [{ key: "idOf", value:

      function idOf(pattern) {
        return pattern[_id2];
      } }]);}();


  /** Pixels as RGBA bytes, not premultiplied: the Web's ImageData. */var _width = Symbol("width");var _height = Symbol("height");var _data = Symbol("data");var
  ImageData = exports.ImageData = /*#__PURE__*/function () {




    function ImageData(dataOrWidth, widthOrHeight, height) {_classCallCheck(this, ImageData);Object.defineProperty(this, _width, { writable: true, value: void 0 });Object.defineProperty(this, _height, { writable: true, value: void 0 });Object.defineProperty(this, _data, { writable: true, value: void 0 });
      if (dataOrWidth instanceof Uint8ClampedArray) {
        var _width2 = widthOrHeight >>> 0;
        var length = dataOrWidth.length;
        if (
        _width2 === 0 ||
        length === 0 ||
        length % 4 !== 0 ||
        length / 4 % _width2 !== 0)

        throw new DOMException(
          'The input data length is not a multiple of (4 * width).',
          'IndexSizeError'
        );
        var _rows = length / 4 / _width2;
        if (height !== undefined && height >>> 0 !== _rows)
        throw new DOMException(
          'The input data length is not equal to (4 * width * height).',
          'IndexSizeError'
        );
        this[_width] = _width2;
        this[_height] = _rows;
        this[_data] = dataOrWidth;
        return;
      }
      var width = dataOrWidth >>> 0;
      var rows = widthOrHeight >>> 0;
      if (width === 0 || rows === 0)
      throw new DOMException(
        'The source width and height must be greater than zero.',
        'IndexSizeError'
      );
      this[_width] = width;
      this[_height] = rows;
      this[_data] = new Uint8ClampedArray(width * rows * 4);
    }return _createClass(ImageData, [{ key: "width", get:

      function () {
        return this[_width];
      } }, { key: "height", get:

      function () {
        return this[_height];
      } }, { key: "data", get:

      function () {
        return this[_data];
      } }, { key: "colorSpace", get:

      function () {
        return 'srgb';
      } }]);}();


  /** What measureText() knows: the advance, and the font's ascent and descent. */var _values = Symbol("values");var
  TextMetrics = exports.TextMetrics = /*#__PURE__*/function () {


    function TextMetrics(token, values) {_classCallCheck(this, TextMetrics);Object.defineProperty(this, _values, { writable: true, value: void 0 });
      if (token !== CONSTRUCTING) throw new TypeError('Illegal constructor');
      this[_values] = values;
    }return _createClass(TextMetrics, [{ key: "width", get:

      function () {
        return this[_values][0];
      } }, { key: "fontBoundingBoxAscent", get:

      function () {
        return this[_values][1];
      } }, { key: "fontBoundingBoxDescent", get:

      function () {
        return this[_values][2];
      } }]);}();var _canvas = Symbol("canvas");var _node = Symbol("node");var _fillStyle = Symbol("fillStyle");var _strokeStyle = Symbol("strokeStyle");var _path = Symbol("path");var _pathLength = Symbol("pathLength");var _call = Symbol("call");var _flush = Symbol("flush");var _addPath = Symbol("addPath");var _ready = Symbol("ready");var _matrix = Symbol("matrix");var _rectangle = Symbol("rectangle");var


  CanvasRenderingContext2D = exports.CanvasRenderingContext2D = /*#__PURE__*/function () {








    function CanvasRenderingContext2D(token, canvas, node) {_classCallCheck(this, CanvasRenderingContext2D);


















































































































































































































































































































































































































      /** clearRect(), fillRect(), strokeRect(): non-finite numbers do nothing. */Object.defineProperty(this, _rectangle, { value: _rectangle2 }); /** transform() and setTransform() with six numbers: non-finite ones do nothing. */Object.defineProperty(this, _matrix, { value: _matrix2 }); /**
       * Before a direct native call (the most frequent methods call native code
       * with their own arguments, making no arrays): sends the path first.
       */Object.defineProperty(this, _ready, { value: _ready2 }); /**
       * Gathers a path command of `count` arguments (fixed arity, so that a
       * call allocates nothing).
       */Object.defineProperty(this, _addPath, { value: _addPath2 }); /** Sends the path commands gathered so far, before anything else. */Object.defineProperty(this, _flush, { value: _flush2 });Object.defineProperty(this, _call, { value: _call2 });Object.defineProperty(this, _canvas, { writable: true, value: void 0 });Object.defineProperty(this, _node, { writable: true, value: void 0 });Object.defineProperty(this, _fillStyle, { writable: true, value: null });Object.defineProperty(this, _strokeStyle, { writable: true, value: null }); // Path commands not sent yet: [op, arguments...] (see #flush()).
      Object.defineProperty(this, _path, { writable: true, value: new Float64Array(256) });Object.defineProperty(this, _pathLength, { writable: true, value: 0 });if (token !== CONSTRUCTING) throw new TypeError('Illegal constructor');this[_canvas] = canvas;this[_node] = node;}return _createClass(CanvasRenderingContext2D, [{ key: "canvas", get: function () {return this[_canvas];} }, { key: "getContextAttributes", value: function getContextAttributes() {return { alpha: true, colorSpace: 'srgb', desynchronized: false, willReadFrequently: false };} // ── State ──────────────────────────────────────────────────────────────
    }, { key: "save", value: function save() {this[_ready]();native.call2d(this[_node], OP.save);} }, { key: "restore", value: function restore() {this[_ready]();native.call2d(this[_node], OP.restore); // The styles may have changed back.
        this[_fillStyle] = null;this[_strokeStyle] = null;} }, { key: "reset", value: function reset() {this[_call](OP.reset);this[_fillStyle] = null;this[_strokeStyle] = null;} }, { key: "globalAlpha", get: function () {return this[_call](OP.globalAlpha);}, set: function (value) {var alpha = number(value);if (Number.isFinite(alpha)) this[_call](OP.setGlobalAlpha, alpha);} }, { key: "globalCompositeOperation", get: function () {return this[_call](OP.compositeOperation);}, set: function (value) {this[_call](OP.setCompositeOperation, String(value));} // ── Transforms ─────────────────────────────────────────────────────────
    }, { key: "scale", value: function scale(x, y) {requireArguments('scale', arguments.length, 2);x = number(x);y = number(y);if (!Number.isFinite(x) || !Number.isFinite(y)) return;this[_ready]();native.call2d(this[_node], OP.scale, x, y);} }, { key: "rotate", value: function rotate(angle) {requireArguments('rotate', arguments.length, 1);angle = number(angle);if (!Number.isFinite(angle)) return;this[_ready]();native.call2d(this[_node], OP.rotate, angle);} }, { key: "translate", value: function translate(x, y) {requireArguments('translate', arguments.length, 2);x = number(x);y = number(y);if (!Number.isFinite(x) || !Number.isFinite(y)) return;this[_ready]();native.call2d(this[_node], OP.translate, x, y);} }, { key: "transform", value: function transform(a, b, c, d, e, f) {requireArguments('transform', arguments.length, 6);this[_matrix](OP.transform, a, b, c, d, e, f);} }, { key: "setTransform", value: function setTransform(a, b, c, d, e, f) {if (arguments.length <= 1) {// setTransform() and setTransform({ a, b, c, d, e, f }).
          var m = a ?? {};var values = [m.a ?? m.m11 ?? 1, m.b ?? m.m12 ?? 0, m.c ?? m.m21 ?? 0, m.d ?? m.m22 ?? 1, m.e ?? m.m41 ?? 0, m.f ?? m.m42 ?? 0].map(number);if (!finite(...values)) throw new TypeError("Failed to execute 'setTransform' on 'CanvasRenderingContext2D': The provided matrix has non-finite values.");this[_call](OP.setTransform, ...values);return;}requireArguments('setTransform', arguments.length, 6);this[_matrix](OP.setTransform, a, b, c, d, e, f);} }, { key: "resetTransform", value: function resetTransform() {this[_call](OP.resetTransform);} /** The current transform, as a plain { a, b, c, d, e, f } (Soundor has no DOMMatrix). */ }, { key: "getTransform", value: function getTransform() {var [a, b, c, d, e, f] = this[_call](OP.getTransform);return Object.freeze({ a, b, c, d, e, f, is2D: true });} // ── Styles ─────────────────────────────────────────────────────────────
    }, { key: "fillStyle", get: function () {return this[_fillStyle] ?? this[_call](OP.fillColor);}, set: function (value) {if (value instanceof CanvasGradient) {this[_call](OP.setFillPaint, CanvasGradient.idOf(value));this[_fillStyle] = value;} else if (value instanceof CanvasPattern) {this[_call](OP.setFillPaint, CanvasPattern.idOf(value));this[_fillStyle] = value;} else if (this[_call](OP.setFillColor, String(value))) {this[_fillStyle] = null;}} }, { key: "strokeStyle", get: function () {return this[_strokeStyle] ?? this[_call](OP.strokeColor);}, set: function (value) {if (value instanceof CanvasGradient) {this[_call](OP.setStrokePaint, CanvasGradient.idOf(value));this[_strokeStyle] = value;} else if (value instanceof CanvasPattern) {this[_call](OP.setStrokePaint, CanvasPattern.idOf(value));this[_strokeStyle] = value;} else if (this[_call](OP.setStrokeColor, String(value))) {this[_strokeStyle] = null;}} }, { key: "createLinearGradient", value: function createLinearGradient(x0, y0, x1, y1) {requireArguments('createLinearGradient', arguments.length, 4);var values = [x0, y0, x1, y1].map(number);if (!finite(...values)) throw new TypeError("Failed to execute 'createLinearGradient' on 'CanvasRenderingContext2D': The provided double value is non-finite.");return new CanvasGradient(CONSTRUCTING, native.gradient2d(0, ...values));} }, { key: "createRadialGradient", value: function createRadialGradient(x0, y0, r0, x1, y1, r1) {requireArguments('createRadialGradient', arguments.length, 6);var values = [x0, y0, r0, x1, y1, r1].map(number);if (!finite(...values)) throw new TypeError("Failed to execute 'createRadialGradient' on 'CanvasRenderingContext2D': The provided double value is non-finite.");if (values[2] < 0 || values[5] < 0) throw new DOMException(`The ${values[2] < 0 ? 'r0' : 'r1'} provided is less than 0.`, 'IndexSizeError');return new CanvasGradient(CONSTRUCTING, native.gradient2d(1, ...values));} }, { key: "createConicGradient", value: function createConicGradient(angle, x, y) {requireArguments('createConicGradient', arguments.length, 3);var values = [angle, x, y].map(number);if (!finite(...values)) throw new TypeError("Failed to execute 'createConicGradient' on 'CanvasRenderingContext2D': The provided double value is non-finite.");return new CanvasGradient(CONSTRUCTING, native.gradient2d(2, ...values));} }, { key: "createPattern", value: function createPattern(image, repetition) {requireArguments('createPattern', arguments.length, 2);var source = sourceOf(image);if (source === null || source.kind !== 'canvas') throw unsupported('createPattern() from anything but a canvas');var repeat = repetition === null || repetition === undefined ? '' : String(repetition);if (!['', 'repeat', 'repeat-x', 'repeat-y', 'no-repeat'].includes(repeat)) throw new DOMException(`The provided type ('${repeat}') is not one of 'repeat', 'no-repeat', 'repeat-x', or 'repeat-y'.`, 'SyntaxError');return new CanvasPattern(CONSTRUCTING, native.pattern2d(this[_node], source.id, repeat));} }, { key: "lineWidth", get: function () {return this[_call](OP.lineWidth);}, set: function (value) {var width = number(value);if (Number.isFinite(width)) this[_call](OP.setLineWidth, width);} }, { key: "lineCap", get: function () {return this[_call](OP.lineCap);}, set: function (value) {this[_call](OP.setLineCap, String(value));} }, { key: "lineJoin", get: function () {return this[_call](OP.lineJoin);}, set: function (value) {this[_call](OP.setLineJoin, String(value));} }, { key: "miterLimit", get: function () {return this[_call](OP.miterLimit);}, set: function (value) {var limit = number(value);if (Number.isFinite(limit)) this[_call](OP.setMiterLimit, limit);} }, { key: "setLineDash", value: function setLineDash(segments) {requireArguments('setLineDash', arguments.length, 1);var values = Array.from(segments, number);if (values.every((value) => Number.isFinite(value) && value >= 0)) this[_call](OP.setLineDash, values);} }, { key: "getLineDash", value: function getLineDash() {return this[_call](OP.lineDash);} }, { key: "lineDashOffset", get: function () {return this[_call](OP.lineDashOffset);}, set: function (value) {var offset = number(value);if (Number.isFinite(offset)) this[_call](OP.setLineDashOffset, offset);} // Shadows and filters: not drawn by Soundor yet, so only their defaults.
    }, { key: "shadowBlur", get: function () {return 0;}, set: function (value) {if (number(value) !== 0) throw unsupported('shadowBlur');} }, { key: "shadowOffsetX", get: function () {return 0;}, set: function (value) {if (number(value) !== 0) throw unsupported('shadowOffsetX');} }, { key: "shadowOffsetY", get: function () {return 0;}, set: function (value) {if (number(value) !== 0) throw unsupported('shadowOffsetY');} }, { key: "shadowColor", get: function () {return 'rgba(0, 0, 0, 0)';}, set: function (value) {var color = String(value).replaceAll(' ', '').toLowerCase();if (color !== 'transparent' && color !== 'rgba(0,0,0,0)') throw unsupported('shadowColor');} }, { key: "filter", get: function () {return 'none';}, set: function (value) {if (String(value) !== 'none') throw unsupported('filter');} // ── Rectangles ─────────────────────────────────────────────────────────
    }, { key: "clearRect", value: function clearRect(x, y, width, height) {requireArguments('clearRect', arguments.length, 4);this[_rectangle](OP.clearRect, x, y, width, height);} }, { key: "fillRect", value: function fillRect(x, y, width, height) {requireArguments('fillRect', arguments.length, 4);this[_rectangle](OP.fillRect, x, y, width, height);} }, { key: "strokeRect", value: function strokeRect(x, y, width, height) {requireArguments('strokeRect', arguments.length, 4);this[_rectangle](OP.strokeRect, x, y, width, height);} }, { key: "beginPath", value:


      // ── Paths ──────────────────────────────────────────────────────────────
      // Gathered and sent before the next other call (#addPath, #flush): checked
      // and converted here, as they are made, so errors come at the same time.

      function beginPath() {
        this[_addPath](0, OP.beginPath);
      } }, { key: "closePath", value:

      function closePath() {
        this[_addPath](0, OP.closePath);
      } }, { key: "moveTo", value:

      function moveTo(x, y) {
        requireArguments('moveTo', arguments.length, 2);
        x = number(x);
        y = number(y);
        if (Number.isFinite(x) && Number.isFinite(y))
        this[_addPath](2, OP.moveTo, x, y);
      } }, { key: "lineTo", value:

      function lineTo(x, y) {
        requireArguments('lineTo', arguments.length, 2);
        x = number(x);
        y = number(y);
        if (Number.isFinite(x) && Number.isFinite(y))
        this[_addPath](2, OP.lineTo, x, y);
      } }, { key: "quadraticCurveTo", value:

      function quadraticCurveTo(cx, cy, x, y) {
        requireArguments('quadraticCurveTo', arguments.length, 4);
        cx = number(cx);
        cy = number(cy);
        x = number(x);
        y = number(y);
        if (finiteNumbers(cx, cy, x, y))
        this[_addPath](4, OP.quadraticCurveTo, cx, cy, x, y);
      } }, { key: "bezierCurveTo", value:

      function bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
        requireArguments('bezierCurveTo', arguments.length, 6);
        c1x = number(c1x);
        c1y = number(c1y);
        c2x = number(c2x);
        c2y = number(c2y);
        x = number(x);
        y = number(y);
        if (finiteNumbers(c1x, c1y, c2x, c2y, x, y))
        this[_addPath](6, OP.bezierCurveTo, c1x, c1y, c2x, c2y, x, y);
      } }, { key: "arcTo", value:

      function arcTo(x1, y1, x2, y2, radius) {
        requireArguments('arcTo', arguments.length, 5);
        x1 = number(x1);
        y1 = number(y1);
        x2 = number(x2);
        y2 = number(y2);
        radius = number(radius);
        if (!finiteNumbers(x1, y1, x2, y2, radius)) return;
        if (radius < 0)
        throw new DOMException(
          `The radius provided (${radius}) is negative.`,
          'IndexSizeError'
        );
        this[_addPath](5, OP.arcTo, x1, y1, x2, y2, radius);
      } }, { key: "rect", value:

      function rect(x, y, width, height) {
        requireArguments('rect', arguments.length, 4);
        x = number(x);
        y = number(y);
        width = number(width);
        height = number(height);
        if (finiteNumbers(x, y, width, height))
        this[_addPath](4, OP.rect, x, y, width, height);
      } }, { key: "roundRect", value:

      function roundRect(x, y, width, height, radii = 0) {
        requireArguments('roundRect', arguments.length, 4);
        var values = [x, y, width, height].map(number);
        var list = (Array.isArray(radii) ? radii : [radii]).map((radius) => {
          if (typeof radius === 'object' && radius !== null)
          throw unsupported('roundRect() with DOMPointInit radii');
          return number(radius);
        });
        if (list.length < 1 || list.length > 4)
        throw new RangeError(
          `${list.length} radii provided. Between one and four radii are necessary.`
        );
        if (!finite(...values, ...list)) return;
        if (list.some((radius) => radius < 0))
        throw new RangeError('A radius provided is negative.');
        this[_call](OP.roundRect, ...values, list);
      } }, { key: "arc", value:

      function arc(x, y, radius, startAngle, endAngle, counterclockwise = false) {
        requireArguments('arc', arguments.length, 5);
        x = number(x);
        y = number(y);
        radius = number(radius);
        startAngle = number(startAngle);
        endAngle = number(endAngle);
        if (!finiteNumbers(x, y, radius, startAngle, endAngle)) return;
        if (radius < 0)
        throw new DOMException(
          `The radius provided (${radius}) is negative.`,
          'IndexSizeError'
        );
        this[_addPath](
          6,
          OP.arc,
          x,
          y,
          radius,
          startAngle,
          endAngle,
          counterclockwise ? 1 : 0);

      } }, { key: "ellipse", value:

      function ellipse(
      x,
      y,
      radiusX,
      radiusY,
      rotation,
      startAngle,
      endAngle,
      counterclockwise = false)
      {
        requireArguments('ellipse', arguments.length, 7);
        var values = [x, y, radiusX, radiusY, rotation, startAngle, endAngle].map(
          number
        );
        if (!finite(...values)) return;
        if (values[2] < 0 || values[3] < 0)
        throw new DOMException(
          `The ${values[2] < 0 ? 'major' : 'minor'}-axis radius provided is negative.`,
          'IndexSizeError'
        );
        this[_addPath](8, OP.ellipse, ...values, counterclockwise ? 1 : 0);
      } }, { key: "fill", value:

      function fill(rule) {
        var evenOdd = fillRule(rule, 'fill');
        this[_ready]();
        native.call2d(this[_node], OP.fill, evenOdd);
      } }, { key: "stroke", value:

      function stroke(path) {
        if (path !== undefined) throw unsupported('stroke() with a Path2D');
        this[_ready]();
        native.call2d(this[_node], OP.stroke);
      } }, { key: "clip", value:

      function clip(rule) {
        this[_call](OP.clip, fillRule(rule, 'clip'));
      } }, { key: "isPointInPath", value:

      function isPointInPath(x, y, rule) {
        if (typeof x === 'object' && x !== null)
        throw unsupported('isPointInPath() with a Path2D');
        requireArguments('isPointInPath', arguments.length, 2);
        x = number(x);
        y = number(y);
        if (!finite(x, y)) return false;
        return this[_call](OP.isPointInPath, x, y, fillRule(rule, 'isPointInPath'));
      } }, { key: "isPointInStroke", value:

      function isPointInStroke(x, y) {
        if (typeof x === 'object' && x !== null)
        throw unsupported('isPointInStroke() with a Path2D');
        requireArguments('isPointInStroke', arguments.length, 2);
        x = number(x);
        y = number(y);
        if (!finite(x, y)) return false;
        return this[_call](OP.isPointInStroke, x, y);
      }

      // ── Text ───────────────────────────────────────────────────────────────
    }, { key: "font", get:
      function () {
        return this[_call](OP.font);
      }, set:

      function (value) {
        this[_call](OP.setFont, String(value));
      } }, { key: "textAlign", get:

      function () {
        return this[_call](OP.textAlign);
      }, set:

      function (value) {
        this[_call](OP.setTextAlign, String(value));
      } }, { key: "textBaseline", get:

      function () {
        return this[_call](OP.textBaseline);
      }, set:

      function (value) {
        this[_call](OP.setTextBaseline, String(value));
      } }, { key: "direction", get:

      function () {
        return 'ltr';
      }, set:

      function (value) {
        if (String(value) !== 'ltr' && String(value) !== 'inherit')
        throw unsupported(`direction '${value}'`);
      } }, { key: "fillText", value:

      function fillText(text, x, y, maxWidth) {
        requireArguments('fillText', arguments.length, 3);
        x = number(x);
        y = number(y);
        var width = maxWidth === undefined ? undefined : number(maxWidth);
        if (!finite(x, y) || width !== undefined && Number.isNaN(width)) return;
        this[_call](OP.fillText, String(text), x, y, width);
      } }, { key: "strokeText", value:

      function strokeText(text, x, y, maxWidth) {
        requireArguments('strokeText', arguments.length, 3);
        x = number(x);
        y = number(y);
        var width = maxWidth === undefined ? undefined : number(maxWidth);
        if (!finite(x, y) || width !== undefined && Number.isNaN(width)) return;
        this[_call](OP.strokeText, String(text), x, y, width);
      } }, { key: "measureText", value:

      function measureText(text) {
        requireArguments('measureText', arguments.length, 1);
        return new TextMetrics(
          CONSTRUCTING,
          this[_call](OP.measureText, String(text))
        );
      }

      // ── Images and pixels ──────────────────────────────────────────────────
    }, { key: "imageSmoothingEnabled", get:
      function () {
        return this[_call](OP.imageSmoothing);
      }, set:

      function (value) {
        this[_call](OP.setImageSmoothing, Boolean(value));
      } }, { key: "imageSmoothingQuality", get:

      function () {
        return 'low';
      }, set:

      function (value) {
        if (String(value) !== 'low')
        throw unsupported(`imageSmoothingQuality '${value}'`);
      } }, { key: "drawImage", value:

      function drawImage(image, ...rest) {
        requireArguments('drawImage', arguments.length, 3);
        if (rest.length !== 2 && rest.length !== 4 && rest.length !== 8)
        throw new TypeError(
          `Failed to execute 'drawImage' on 'CanvasRenderingContext2D': Valid arities are: [3, 5, 9], but ${arguments.length} arguments provided.`
        );
        var source = sourceOf(image);
        if (source === null)
        throw new TypeError(
          "Failed to execute 'drawImage' on 'CanvasRenderingContext2D': The provided value is not a canvas or image node."
        );
        var values = rest.map(number);
        if (!finite(...values)) return;
        if (source.kind === 'canvas') {
          var { width, height } = source;
          if (width === 0 || height === 0)
          throw new DOMException(
            'The image argument is a canvas element with a width or height of 0.',
            'InvalidStateError'
          );
          var [_sx, _sy, _sw, _sh, _dx, _dy, _dw, _dh] = [
          0,
          0,
          width,
          height,
          0,
          0,
          width,
          height];

          if (values.length === 2) [_dx, _dy] = values;else
          if (values.length === 4) [_dx, _dy, _dw, _dh] = values;else
          [_sx, _sy, _sw, _sh, _dx, _dy, _dw, _dh] = values;
          this[_call](OP.drawCanvas, source.id, _sx, _sy, _sw, _sh, _dx, _dy, _dw, _dh);
          return;
        }
        // A bundled image (an image node's asset).
        var hasSource = values.length === 8;
        var [sx, sy, sw, sh] = hasSource ? values : [0, 0, 0, 0];
        var [dx, dy, dw, dh] = hasSource ? values.slice(4) : values;
        this[_call](
          OP.drawAsset,
          source.asset,
          hasSource,
          sx,
          sy,
          sw,
          sh,
          dx,
          dy,
          dw,
          dh);

      } }, { key: "createImageData", value:

      function createImageData(widthOrImageData, height) {
        if (widthOrImageData instanceof ImageData)
        return new ImageData(widthOrImageData.width, widthOrImageData.height);
        requireArguments('createImageData', arguments.length, 2);
        var width = Math.abs(Math.trunc(number(widthOrImageData)));
        var rows = Math.abs(Math.trunc(number(height)));
        return new ImageData(width, rows);
      } }, { key: "getImageData", value:

      function getImageData(x, y, width, height) {
        requireArguments('getImageData', arguments.length, 4);
        var values = [x, y, width, height].map((value) =>
        Math.trunc(number(value))
        );
        if (!finite(...values))
        throw new TypeError(
          "Failed to execute 'getImageData' on 'CanvasRenderingContext2D': The provided double value is non-finite."
        );
        var [sx, sy, sw, sh] = values;
        if (sw === 0 || sh === 0)
        throw new DOMException(
          `The source ${sw === 0 ? 'width' : 'height'} is 0.`,
          'IndexSizeError'
        );
        // A negative size reads back from (x, y).
        if (sw < 0) [sx, sw] = [sx + sw, -sw];
        if (sh < 0) [sy, sh] = [sy + sh, -sh];
        var bytes = this[_call](OP.getImageData, sx, sy, sw, sh);
        return new ImageData(new Uint8ClampedArray(bytes), sw, sh);
      } }, { key: "putImageData", value:

      function putImageData(
      imageData,
      dx,
      dy,
      dirtyX = 0,
      dirtyY = 0,
      dirtyWidth,
      dirtyHeight)
      {
        requireArguments('putImageData', arguments.length, 3);
        if (!(imageData instanceof ImageData))
        throw new TypeError(
          "Failed to execute 'putImageData' on 'CanvasRenderingContext2D': parameter 1 is not of type 'ImageData'."
        );
        var { width, height } = imageData;
        var values = [
        dx,
        dy,
        dirtyX,
        dirtyY,
        dirtyWidth ?? width,
        dirtyHeight ?? height].
        map((value) => Math.trunc(number(value)));
        if (!finite(...values)) return;
        var { data } = imageData;
        // The same bytes, as the Uint8Array native code reads.
        var bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        this[_call](OP.putImageData, bytes, width, height, ...values);
      } }]);}();


  /** The 2D context of a canvas node (cached by soundor:ui). */function _call2(op, ...args) {if (this[_pathLength] > 0) this[_flush]();return native.call2d(this[_node], op, ...args);}function _flush2() {var length = this[_pathLength];this[_pathLength] = 0;native.call2d(this[_node], OP.path, this[_path], length);}function _addPath2(count, op, a, b, c, d, e, f, g, h) {var at = this[_pathLength];if (at + count + 1 > this[_path].length) {if (at + count + 1 > PATH_LIMIT) {this[_flush]();at = 0;} else {var grown = new Float64Array(this[_path].length * 2);grown.set(this[_path].subarray(0, at));this[_path] = grown;}}var path = this[_path];path[at++] = op;if (count > 0) path[at++] = a;if (count > 1) path[at++] = b;if (count > 2) path[at++] = c;if (count > 3) path[at++] = d;if (count > 4) path[at++] = e;if (count > 5) path[at++] = f;if (count > 6) path[at++] = g;if (count > 7) path[at++] = h;this[_pathLength] = at;}function _ready2() {if (this[_pathLength] > 0) this[_flush]();}function _matrix2(op, a, b, c, d, e, f) {a = number(a);b = number(b);c = number(c);d = number(d);e = number(e);f = number(f);if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d) || !Number.isFinite(e) || !Number.isFinite(f)) return;this[_ready]();native.call2d(this[_node], op, a, b, c, d, e, f);}function _rectangle2(op, x, y, width, height) {x = number(x);y = number(y);width = number(width);height = number(height);if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) return;this[_ready]();native.call2d(this[_node], op, x, y, width, height);}exports.resetContext = resetContext = (context) => {context[_fillStyle] = null;context[_strokeStyle] = null; // The resize cleared the path these were for.
    context[_pathLength] = 0;};function createContext2D(canvas, node) {
    return new CanvasRenderingContext2D(CONSTRUCTING, canvas, node);
  }

  // Web globals, as in a browser's window.
  for (var [name, value] of Object.entries({
    CanvasGradient,
    CanvasPattern,
    CanvasRenderingContext2D,
    ImageData,
    TextMetrics
  })) {
    Object.defineProperty(globalThis, name, {
      value,
      writable: true,
      enumerable: false,
      configurable: true
    });
  }});
// Generated from native/src/modules/ui/canvas.js by scripts/native-modules.mjs. Do not edit.
