// A canvas node's 2D context (CanvasRenderingContext2D), with ImageData,
// CanvasGradient, CanvasPattern and TextMetrics, as on the Web.
//
// Embedded into the native runtime; part of soundor:ui. Drawing happens
// natively (Skia, on the CPU) into the canvas's pixels: each method converts
// its arguments the way WebIDL would, then makes one native call,
// call2d(node, op, ...). What Soundor does not implement throws a TypeError
// saying so, rather than drawing something else.

import * as native from 'soundor:internal/ui';

// The operations native code knows, by number (src/modules/ui/CanvasModule.h).
const OP = {
  save: 0,
  restore: 1,
  reset: 2,
  globalAlpha: 3,
  setGlobalAlpha: 4,
  compositeOperation: 5,
  setCompositeOperation: 6,
  scale: 7,
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
};

const CONSTRUCTING = Symbol('constructing');

/** Gradients and patterns are native; they go when their objects do. */
const paints = new FinalizationRegistry((id) => native.release2d(0, id));

/** The canvas was resized: its context's styles went back to black. */
export let forgetStyles;

/** What a canvas source is, for drawImage() and createPattern(). */
let sourceOf = () => null;

/** Lets soundor:ui say which nodes are canvases and images. */
export function setSourceResolver(resolve) {
  sourceOf = resolve;
}

function number(value) {
  return Number(value);
}

function finite(...values) {
  return values.every((value) => Number.isFinite(value));
}

function unsupported(what) {
  return new TypeError(`${what} is not supported by Soundor's 2D canvas`);
}

function requireArguments(name, given, required) {
  if (given < required) {
    throw new TypeError(
      `Failed to execute '${name}' on 'CanvasRenderingContext2D': ${required} arguments required, but only ${given} present.`,
    );
  }
}

function fillRule(value, name) {
  if (value === undefined || value === 'nonzero') return false;
  if (value === 'evenodd') return true;
  if (typeof value === 'object' && value !== null)
    throw unsupported(`${name}() with a Path2D`);
  throw new TypeError(
    `The provided value '${value}' is not a valid enum value of type CanvasFillRule.`,
  );
}

export class CanvasGradient {
  #id;

  constructor(token, id) {
    if (token !== CONSTRUCTING) throw new TypeError('Illegal constructor');
    this.#id = id;
    paints.register(this, id);
  }

  addColorStop(offset, color) {
    const at = number(offset);
    if (!Number.isFinite(at))
      throw new TypeError(
        "Failed to execute 'addColorStop' on 'CanvasGradient': The provided double value is non-finite.",
      );
    if (at < 0 || at > 1)
      throw new DOMException(
        `The provided value (${at}) is outside the range (0.0, 1.0).`,
        'IndexSizeError',
      );
    if (!native.colorStop2d(this.#id, at, String(color)))
      throw new DOMException(
        `The value provided ('${color}') could not be parsed as a color.`,
        'SyntaxError',
      );
  }

  static idOf(gradient) {
    return gradient.#id;
  }
}

export class CanvasPattern {
  #id;

  constructor(token, id) {
    if (token !== CONSTRUCTING) throw new TypeError('Illegal constructor');
    this.#id = id;
    paints.register(this, id);
  }

  setTransform() {
    throw unsupported('CanvasPattern.setTransform()');
  }

  static idOf(pattern) {
    return pattern.#id;
  }
}

/** Pixels as RGBA bytes, not premultiplied: the Web's ImageData. */
export class ImageData {
  #width;
  #height;
  #data;

  constructor(dataOrWidth, widthOrHeight, height) {
    if (dataOrWidth instanceof Uint8ClampedArray) {
      const width = widthOrHeight >>> 0;
      const length = dataOrWidth.length;
      if (
        width === 0 ||
        length === 0 ||
        length % 4 !== 0 ||
        (length / 4) % width !== 0
      )
        throw new DOMException(
          'The input data length is not a multiple of (4 * width).',
          'IndexSizeError',
        );
      const rows = length / 4 / width;
      if (height !== undefined && height >>> 0 !== rows)
        throw new DOMException(
          'The input data length is not equal to (4 * width * height).',
          'IndexSizeError',
        );
      this.#width = width;
      this.#height = rows;
      this.#data = dataOrWidth;
      return;
    }
    const width = dataOrWidth >>> 0;
    const rows = widthOrHeight >>> 0;
    if (width === 0 || rows === 0)
      throw new DOMException(
        'The source width and height must be greater than zero.',
        'IndexSizeError',
      );
    this.#width = width;
    this.#height = rows;
    this.#data = new Uint8ClampedArray(width * rows * 4);
  }

  get width() {
    return this.#width;
  }

  get height() {
    return this.#height;
  }

  get data() {
    return this.#data;
  }

  get colorSpace() {
    return 'srgb';
  }
}

/** What measureText() knows: the advance, and the font's ascent and descent. */
export class TextMetrics {
  #values;

  constructor(token, values) {
    if (token !== CONSTRUCTING) throw new TypeError('Illegal constructor');
    this.#values = values;
  }

  get width() {
    return this.#values[0];
  }

  get fontBoundingBoxAscent() {
    return this.#values[1];
  }

  get fontBoundingBoxDescent() {
    return this.#values[2];
  }
}

export class CanvasRenderingContext2D {
  #canvas;
  #node;
  #fillStyle = null;
  #strokeStyle = null;

  constructor(token, canvas, node) {
    if (token !== CONSTRUCTING) throw new TypeError('Illegal constructor');
    this.#canvas = canvas;
    this.#node = node;
  }

  #call(op, ...args) {
    return native.call2d(this.#node, op, ...args);
  }

  static {
    forgetStyles = (context) => {
      context.#fillStyle = null;
      context.#strokeStyle = null;
    };
  }

  get canvas() {
    return this.#canvas;
  }

  getContextAttributes() {
    return {
      alpha: true,
      colorSpace: 'srgb',
      desynchronized: false,
      willReadFrequently: false,
    };
  }

  // ── State ──────────────────────────────────────────────────────────────

  save() {
    this.#call(OP.save);
  }

  restore() {
    this.#call(OP.restore);
    // The styles may have changed back.
    this.#fillStyle = null;
    this.#strokeStyle = null;
  }

  reset() {
    this.#call(OP.reset);
    this.#fillStyle = null;
    this.#strokeStyle = null;
  }

  get globalAlpha() {
    return this.#call(OP.globalAlpha);
  }

  set globalAlpha(value) {
    const alpha = number(value);
    if (Number.isFinite(alpha)) this.#call(OP.setGlobalAlpha, alpha);
  }

  get globalCompositeOperation() {
    return this.#call(OP.compositeOperation);
  }

  set globalCompositeOperation(value) {
    this.#call(OP.setCompositeOperation, String(value));
  }

  // ── Transforms ─────────────────────────────────────────────────────────

  scale(x, y) {
    requireArguments('scale', arguments.length, 2);
    x = number(x);
    y = number(y);
    if (finite(x, y)) this.#call(OP.scale, x, y);
  }

  rotate(angle) {
    requireArguments('rotate', arguments.length, 1);
    angle = number(angle);
    if (finite(angle)) this.#call(OP.rotate, angle);
  }

  translate(x, y) {
    requireArguments('translate', arguments.length, 2);
    x = number(x);
    y = number(y);
    if (finite(x, y)) this.#call(OP.translate, x, y);
  }

  transform(a, b, c, d, e, f) {
    requireArguments('transform', arguments.length, 6);
    const values = [a, b, c, d, e, f].map(number);
    if (finite(...values)) this.#call(OP.transform, ...values);
  }

  setTransform(a, b, c, d, e, f) {
    if (arguments.length <= 1) {
      // setTransform() and setTransform({ a, b, c, d, e, f }).
      const m = a ?? {};
      const values = [
        m.a ?? m.m11 ?? 1,
        m.b ?? m.m12 ?? 0,
        m.c ?? m.m21 ?? 0,
        m.d ?? m.m22 ?? 1,
        m.e ?? m.m41 ?? 0,
        m.f ?? m.m42 ?? 0,
      ].map(number);
      if (!finite(...values))
        throw new TypeError(
          "Failed to execute 'setTransform' on 'CanvasRenderingContext2D': The provided matrix has non-finite values.",
        );
      this.#call(OP.setTransform, ...values);
      return;
    }
    requireArguments('setTransform', arguments.length, 6);
    const values = [a, b, c, d, e, f].map(number);
    if (finite(...values)) this.#call(OP.setTransform, ...values);
  }

  resetTransform() {
    this.#call(OP.resetTransform);
  }

  /** The current transform, as a plain { a, b, c, d, e, f } (Soundor has no DOMMatrix). */
  getTransform() {
    const [a, b, c, d, e, f] = this.#call(OP.getTransform);
    return Object.freeze({ a, b, c, d, e, f, is2D: true });
  }

  // ── Styles ─────────────────────────────────────────────────────────────

  get fillStyle() {
    return this.#fillStyle ?? this.#call(OP.fillColor);
  }

  set fillStyle(value) {
    if (value instanceof CanvasGradient) {
      this.#call(OP.setFillPaint, CanvasGradient.idOf(value));
      this.#fillStyle = value;
    } else if (value instanceof CanvasPattern) {
      this.#call(OP.setFillPaint, CanvasPattern.idOf(value));
      this.#fillStyle = value;
    } else if (this.#call(OP.setFillColor, String(value))) {
      this.#fillStyle = null;
    }
  }

  get strokeStyle() {
    return this.#strokeStyle ?? this.#call(OP.strokeColor);
  }

  set strokeStyle(value) {
    if (value instanceof CanvasGradient) {
      this.#call(OP.setStrokePaint, CanvasGradient.idOf(value));
      this.#strokeStyle = value;
    } else if (value instanceof CanvasPattern) {
      this.#call(OP.setStrokePaint, CanvasPattern.idOf(value));
      this.#strokeStyle = value;
    } else if (this.#call(OP.setStrokeColor, String(value))) {
      this.#strokeStyle = null;
    }
  }

  createLinearGradient(x0, y0, x1, y1) {
    requireArguments('createLinearGradient', arguments.length, 4);
    const values = [x0, y0, x1, y1].map(number);
    if (!finite(...values))
      throw new TypeError(
        "Failed to execute 'createLinearGradient' on 'CanvasRenderingContext2D': The provided double value is non-finite.",
      );
    return new CanvasGradient(CONSTRUCTING, native.gradient2d(0, ...values));
  }

  createRadialGradient(x0, y0, r0, x1, y1, r1) {
    requireArguments('createRadialGradient', arguments.length, 6);
    const values = [x0, y0, r0, x1, y1, r1].map(number);
    if (!finite(...values))
      throw new TypeError(
        "Failed to execute 'createRadialGradient' on 'CanvasRenderingContext2D': The provided double value is non-finite.",
      );
    if (values[2] < 0 || values[5] < 0)
      throw new DOMException(
        `The ${values[2] < 0 ? 'r0' : 'r1'} provided is less than 0.`,
        'IndexSizeError',
      );
    return new CanvasGradient(CONSTRUCTING, native.gradient2d(1, ...values));
  }

  createConicGradient(angle, x, y) {
    requireArguments('createConicGradient', arguments.length, 3);
    const values = [angle, x, y].map(number);
    if (!finite(...values))
      throw new TypeError(
        "Failed to execute 'createConicGradient' on 'CanvasRenderingContext2D': The provided double value is non-finite.",
      );
    return new CanvasGradient(CONSTRUCTING, native.gradient2d(2, ...values));
  }

  createPattern(image, repetition) {
    requireArguments('createPattern', arguments.length, 2);
    const source = sourceOf(image);
    if (source === null || source.kind !== 'canvas')
      throw unsupported('createPattern() from anything but a canvas');
    const repeat =
      repetition === null || repetition === undefined ? '' : String(repetition);
    if (!['', 'repeat', 'repeat-x', 'repeat-y', 'no-repeat'].includes(repeat))
      throw new DOMException(
        `The provided type ('${repeat}') is not one of 'repeat', 'no-repeat', 'repeat-x', or 'repeat-y'.`,
        'SyntaxError',
      );
    return new CanvasPattern(
      CONSTRUCTING,
      native.pattern2d(this.#node, source.id, repeat),
    );
  }

  get lineWidth() {
    return this.#call(OP.lineWidth);
  }

  set lineWidth(value) {
    const width = number(value);
    if (Number.isFinite(width)) this.#call(OP.setLineWidth, width);
  }

  get lineCap() {
    return this.#call(OP.lineCap);
  }

  set lineCap(value) {
    this.#call(OP.setLineCap, String(value));
  }

  get lineJoin() {
    return this.#call(OP.lineJoin);
  }

  set lineJoin(value) {
    this.#call(OP.setLineJoin, String(value));
  }

  get miterLimit() {
    return this.#call(OP.miterLimit);
  }

  set miterLimit(value) {
    const limit = number(value);
    if (Number.isFinite(limit)) this.#call(OP.setMiterLimit, limit);
  }

  setLineDash(segments) {
    requireArguments('setLineDash', arguments.length, 1);
    const values = Array.from(segments, number);
    if (values.every((value) => Number.isFinite(value) && value >= 0))
      this.#call(OP.setLineDash, values);
  }

  getLineDash() {
    return this.#call(OP.lineDash);
  }

  get lineDashOffset() {
    return this.#call(OP.lineDashOffset);
  }

  set lineDashOffset(value) {
    const offset = number(value);
    if (Number.isFinite(offset)) this.#call(OP.setLineDashOffset, offset);
  }

  // Shadows and filters: not drawn by Soundor yet, so only their defaults.
  get shadowBlur() {
    return 0;
  }

  set shadowBlur(value) {
    if (number(value) !== 0) throw unsupported('shadowBlur');
  }

  get shadowOffsetX() {
    return 0;
  }

  set shadowOffsetX(value) {
    if (number(value) !== 0) throw unsupported('shadowOffsetX');
  }

  get shadowOffsetY() {
    return 0;
  }

  set shadowOffsetY(value) {
    if (number(value) !== 0) throw unsupported('shadowOffsetY');
  }

  get shadowColor() {
    return 'rgba(0, 0, 0, 0)';
  }

  set shadowColor(value) {
    const color = String(value).replaceAll(' ', '').toLowerCase();
    if (color !== 'transparent' && color !== 'rgba(0,0,0,0)')
      throw unsupported('shadowColor');
  }

  get filter() {
    return 'none';
  }

  set filter(value) {
    if (String(value) !== 'none') throw unsupported('filter');
  }

  // ── Rectangles ─────────────────────────────────────────────────────────

  clearRect(x, y, width, height) {
    requireArguments('clearRect', arguments.length, 4);
    const values = [x, y, width, height].map(number);
    if (finite(...values)) this.#call(OP.clearRect, ...values);
  }

  fillRect(x, y, width, height) {
    requireArguments('fillRect', arguments.length, 4);
    const values = [x, y, width, height].map(number);
    if (finite(...values)) this.#call(OP.fillRect, ...values);
  }

  strokeRect(x, y, width, height) {
    requireArguments('strokeRect', arguments.length, 4);
    const values = [x, y, width, height].map(number);
    if (finite(...values)) this.#call(OP.strokeRect, ...values);
  }

  // ── Paths ──────────────────────────────────────────────────────────────

  beginPath() {
    this.#call(OP.beginPath);
  }

  closePath() {
    this.#call(OP.closePath);
  }

  moveTo(x, y) {
    requireArguments('moveTo', arguments.length, 2);
    x = number(x);
    y = number(y);
    if (finite(x, y)) this.#call(OP.moveTo, x, y);
  }

  lineTo(x, y) {
    requireArguments('lineTo', arguments.length, 2);
    x = number(x);
    y = number(y);
    if (finite(x, y)) this.#call(OP.lineTo, x, y);
  }

  quadraticCurveTo(cx, cy, x, y) {
    requireArguments('quadraticCurveTo', arguments.length, 4);
    const values = [cx, cy, x, y].map(number);
    if (finite(...values)) this.#call(OP.quadraticCurveTo, ...values);
  }

  bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
    requireArguments('bezierCurveTo', arguments.length, 6);
    const values = [c1x, c1y, c2x, c2y, x, y].map(number);
    if (finite(...values)) this.#call(OP.bezierCurveTo, ...values);
  }

  arcTo(x1, y1, x2, y2, radius) {
    requireArguments('arcTo', arguments.length, 5);
    const values = [x1, y1, x2, y2, radius].map(number);
    if (!finite(...values)) return;
    if (values[4] < 0)
      throw new DOMException(
        `The radius provided (${values[4]}) is negative.`,
        'IndexSizeError',
      );
    this.#call(OP.arcTo, ...values);
  }

  rect(x, y, width, height) {
    requireArguments('rect', arguments.length, 4);
    const values = [x, y, width, height].map(number);
    if (finite(...values)) this.#call(OP.rect, ...values);
  }

  roundRect(x, y, width, height, radii = 0) {
    requireArguments('roundRect', arguments.length, 4);
    const values = [x, y, width, height].map(number);
    const list = (Array.isArray(radii) ? radii : [radii]).map((radius) => {
      if (typeof radius === 'object' && radius !== null)
        throw unsupported('roundRect() with DOMPointInit radii');
      return number(radius);
    });
    if (list.length < 1 || list.length > 4)
      throw new RangeError(
        `${list.length} radii provided. Between one and four radii are necessary.`,
      );
    if (!finite(...values, ...list)) return;
    if (list.some((radius) => radius < 0))
      throw new RangeError('A radius provided is negative.');
    this.#call(OP.roundRect, ...values, list);
  }

  arc(x, y, radius, startAngle, endAngle, counterclockwise = false) {
    requireArguments('arc', arguments.length, 5);
    const values = [x, y, radius, startAngle, endAngle].map(number);
    if (!finite(...values)) return;
    if (values[2] < 0)
      throw new DOMException(
        `The radius provided (${values[2]}) is negative.`,
        'IndexSizeError',
      );
    this.#call(OP.arc, ...values, Boolean(counterclockwise));
  }

  ellipse(
    x,
    y,
    radiusX,
    radiusY,
    rotation,
    startAngle,
    endAngle,
    counterclockwise = false,
  ) {
    requireArguments('ellipse', arguments.length, 7);
    const values = [x, y, radiusX, radiusY, rotation, startAngle, endAngle].map(
      number,
    );
    if (!finite(...values)) return;
    if (values[2] < 0 || values[3] < 0)
      throw new DOMException(
        `The ${values[2] < 0 ? 'major' : 'minor'}-axis radius provided is negative.`,
        'IndexSizeError',
      );
    this.#call(OP.ellipse, ...values, Boolean(counterclockwise));
  }

  fill(rule) {
    this.#call(OP.fill, fillRule(rule, 'fill'));
  }

  stroke(path) {
    if (path !== undefined) throw unsupported('stroke() with a Path2D');
    this.#call(OP.stroke);
  }

  clip(rule) {
    this.#call(OP.clip, fillRule(rule, 'clip'));
  }

  isPointInPath(x, y, rule) {
    if (typeof x === 'object' && x !== null)
      throw unsupported('isPointInPath() with a Path2D');
    requireArguments('isPointInPath', arguments.length, 2);
    x = number(x);
    y = number(y);
    if (!finite(x, y)) return false;
    return this.#call(OP.isPointInPath, x, y, fillRule(rule, 'isPointInPath'));
  }

  isPointInStroke(x, y) {
    if (typeof x === 'object' && x !== null)
      throw unsupported('isPointInStroke() with a Path2D');
    requireArguments('isPointInStroke', arguments.length, 2);
    x = number(x);
    y = number(y);
    if (!finite(x, y)) return false;
    return this.#call(OP.isPointInStroke, x, y);
  }

  // ── Text ───────────────────────────────────────────────────────────────

  get font() {
    return this.#call(OP.font);
  }

  set font(value) {
    this.#call(OP.setFont, String(value));
  }

  get textAlign() {
    return this.#call(OP.textAlign);
  }

  set textAlign(value) {
    this.#call(OP.setTextAlign, String(value));
  }

  get textBaseline() {
    return this.#call(OP.textBaseline);
  }

  set textBaseline(value) {
    this.#call(OP.setTextBaseline, String(value));
  }

  get direction() {
    return 'ltr';
  }

  set direction(value) {
    if (String(value) !== 'ltr' && String(value) !== 'inherit')
      throw unsupported(`direction '${value}'`);
  }

  fillText(text, x, y, maxWidth) {
    requireArguments('fillText', arguments.length, 3);
    x = number(x);
    y = number(y);
    const width = maxWidth === undefined ? undefined : number(maxWidth);
    if (!finite(x, y) || (width !== undefined && Number.isNaN(width))) return;
    this.#call(OP.fillText, String(text), x, y, width);
  }

  strokeText(text, x, y, maxWidth) {
    requireArguments('strokeText', arguments.length, 3);
    x = number(x);
    y = number(y);
    const width = maxWidth === undefined ? undefined : number(maxWidth);
    if (!finite(x, y) || (width !== undefined && Number.isNaN(width))) return;
    this.#call(OP.strokeText, String(text), x, y, width);
  }

  measureText(text) {
    requireArguments('measureText', arguments.length, 1);
    return new TextMetrics(
      CONSTRUCTING,
      this.#call(OP.measureText, String(text)),
    );
  }

  // ── Images and pixels ──────────────────────────────────────────────────

  get imageSmoothingEnabled() {
    return this.#call(OP.imageSmoothing);
  }

  set imageSmoothingEnabled(value) {
    this.#call(OP.setImageSmoothing, Boolean(value));
  }

  get imageSmoothingQuality() {
    return 'low';
  }

  set imageSmoothingQuality(value) {
    if (String(value) !== 'low')
      throw unsupported(`imageSmoothingQuality '${value}'`);
  }

  drawImage(image, ...rest) {
    requireArguments('drawImage', arguments.length, 3);
    if (rest.length !== 2 && rest.length !== 4 && rest.length !== 8)
      throw new TypeError(
        `Failed to execute 'drawImage' on 'CanvasRenderingContext2D': Valid arities are: [3, 5, 9], but ${arguments.length} arguments provided.`,
      );
    const source = sourceOf(image);
    if (source === null)
      throw new TypeError(
        "Failed to execute 'drawImage' on 'CanvasRenderingContext2D': The provided value is not a canvas or image node.",
      );
    const values = rest.map(number);
    if (!finite(...values)) return;
    if (source.kind === 'canvas') {
      const { width, height } = source;
      if (width === 0 || height === 0)
        throw new DOMException(
          'The image argument is a canvas element with a width or height of 0.',
          'InvalidStateError',
        );
      let [sx, sy, sw, sh, dx, dy, dw, dh] = [
        0,
        0,
        width,
        height,
        0,
        0,
        width,
        height,
      ];
      if (values.length === 2) [dx, dy] = values;
      else if (values.length === 4) [dx, dy, dw, dh] = values;
      else [sx, sy, sw, sh, dx, dy, dw, dh] = values;
      this.#call(OP.drawCanvas, source.id, sx, sy, sw, sh, dx, dy, dw, dh);
      return;
    }
    // A bundled image (an image node's asset).
    const hasSource = values.length === 8;
    const [sx, sy, sw, sh] = hasSource ? values : [0, 0, 0, 0];
    const [dx, dy, dw, dh] = hasSource ? values.slice(4) : values;
    this.#call(
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
      dh,
    );
  }

  createImageData(widthOrImageData, height) {
    if (widthOrImageData instanceof ImageData)
      return new ImageData(widthOrImageData.width, widthOrImageData.height);
    requireArguments('createImageData', arguments.length, 2);
    const width = Math.abs(Math.trunc(number(widthOrImageData)));
    const rows = Math.abs(Math.trunc(number(height)));
    return new ImageData(width, rows);
  }

  getImageData(x, y, width, height) {
    requireArguments('getImageData', arguments.length, 4);
    const values = [x, y, width, height].map((value) =>
      Math.trunc(number(value)),
    );
    if (!finite(...values))
      throw new TypeError(
        "Failed to execute 'getImageData' on 'CanvasRenderingContext2D': The provided double value is non-finite.",
      );
    let [sx, sy, sw, sh] = values;
    if (sw === 0 || sh === 0)
      throw new DOMException(
        `The source ${sw === 0 ? 'width' : 'height'} is 0.`,
        'IndexSizeError',
      );
    // A negative size reads back from (x, y).
    if (sw < 0) [sx, sw] = [sx + sw, -sw];
    if (sh < 0) [sy, sh] = [sy + sh, -sh];
    const bytes = this.#call(OP.getImageData, sx, sy, sw, sh);
    return new ImageData(new Uint8ClampedArray(bytes), sw, sh);
  }

  putImageData(
    imageData,
    dx,
    dy,
    dirtyX = 0,
    dirtyY = 0,
    dirtyWidth,
    dirtyHeight,
  ) {
    requireArguments('putImageData', arguments.length, 3);
    if (!(imageData instanceof ImageData))
      throw new TypeError(
        "Failed to execute 'putImageData' on 'CanvasRenderingContext2D': parameter 1 is not of type 'ImageData'.",
      );
    const { width, height } = imageData;
    const values = [
      dx,
      dy,
      dirtyX,
      dirtyY,
      dirtyWidth ?? width,
      dirtyHeight ?? height,
    ].map((value) => Math.trunc(number(value)));
    if (!finite(...values)) return;
    const { data } = imageData;
    // The same bytes, as the Uint8Array native code reads.
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.#call(OP.putImageData, bytes, width, height, ...values);
  }
}

/** The 2D context of a canvas node (cached by soundor:ui). */
export function createContext2D(canvas, node) {
  return new CanvasRenderingContext2D(CONSTRUCTING, canvas, node);
}

// Web globals, as in a browser's window.
for (const [name, value] of Object.entries({
  CanvasGradient,
  CanvasPattern,
  CanvasRenderingContext2D,
  ImageData,
  TextMetrics,
})) {
  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}
