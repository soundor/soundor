(function (exports, require, module) {"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.AccessibilityActionEvent = void 0;Object.defineProperty(exports, "CanvasGradient", { enumerable: true, get: function () {return _canvas.CanvasGradient;} });Object.defineProperty(exports, "CanvasPattern", { enumerable: true, get: function () {return _canvas.CanvasPattern;} });Object.defineProperty(exports, "CanvasRenderingContext2D", { enumerable: true, get: function () {return _canvas.CanvasRenderingContext2D;} });exports.FocusEvent = void 0;Object.defineProperty(exports, "ImageData", { enumerable: true, get: function () {return _canvas.ImageData;} });exports.PointerEvent = exports.KeyboardEvent = exports.InputEvent = void 0;Object.defineProperty(exports, "TextMetrics", { enumerable: true, get: function () {return _canvas.TextMetrics;} });exports.UiNode = void 0;Object.defineProperty(exports, "WebGL2RenderingContext", { enumerable: true, get: function () {return _webgl.WebGL2RenderingContext;} });exports.clipboard = exports.WheelEvent = void 0;exports.createCanvas = createCanvas;exports.createImage = createImage;exports.createScrollView = createScrollView;exports.createText = createText;exports.createTextInput = createTextInput;exports.createView = createView;exports.focusedNode = focusedNode;exports.overlayRoot = void 0;exports.pressable = pressable;exports.root = void 0;exports.viewSize = viewSize;














  var native = _interopRequireWildcard(require("soundor:internal/ui"));
  var _canvas = require("soundor:internal/ui/canvas");




  var _webgl = require("soundor:internal/ui/webgl");
  var _events = require("soundor:internal/web/events");var cache;function _interopRequireWildcard(e, t) {if (!t && e && e.__esModule) return e;var r,c,a = Object.defineProperty,n = { __proto__: null, default: e };if (Object(e) !== e) return n;if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) {if (cache.has(e)) return cache.get(e);cache.set(e, n);}for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]);return n;}function asyncGeneratorStep(n, t, e, r, o, a, c) {try {var i = n[a](c),u = i.value;} catch (n) {return void e(n);}i.done ? t(u) : Promise.resolve(u).then(r, o);}function _asyncToGenerator(n) {return function () {var t = this,e = arguments;return new Promise(function (r, o) {var a = n.apply(t, e);function _next(n) {asyncGeneratorStep(a, r, o, _next, _throw, "next", n);}function _throw(n) {asyncGeneratorStep(a, r, o, _next, _throw, "throw", n);}_next(void 0);});};}function _classCallCheck(a, n) {if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");}function _defineProperties(e, r) {for (var t = 0; t < r.length; t++) {var o = r[t];o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o);}}function _createClass(e, r, t) {return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e;}function _toPropertyKey(t) {var i = _toPrimitive(t, "string");return "symbol" == typeof i ? i : i + "";}function _toPrimitive(t, e) {if ("object" != typeof t || !t) return t;var r;if ("undefined" != typeof Symbol && void 0 !== (r = t[Symbol.toPrimitive])) {var i = r.call(t, e || "default");if ("object" != typeof i) return i;throw new TypeError("@@toPrimitive must return a primitive value.");}return ("string" === e ? String : Number)(t);}function _inherits(t, e) {if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function");t.prototype = Object.create(e && e.prototype, { constructor: { value: t, writable: !0, configurable: !0 } }), Object.defineProperty(t, "prototype", { writable: !1 }), e && _setPrototypeOf(t, e);}function _setPrototypeOf(t, e) {return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (t, e) {return t.__proto__ = e, t;}, _setPrototypeOf(t, e);}function _callSuper(t, o, e) {return o = _getPrototypeOf(o), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e));}function _possibleConstructorReturn(t, e) {if (e && ("object" == typeof e || "function" == typeof e)) return e;if (void 0 !== e) throw new TypeError("Derived constructors may only return object or undefined");return _assertThisInitialized(t);}function _assertThisInitialized(e) {if (void 0 === e) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e;}function _isNativeReflectConstruct() {try {var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {}));} catch (t) {}return (_isNativeReflectConstruct = function () {return !!t;})();}function _getPrototypeOf(t) {return _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function (t) {return t.__proto__ || Object.getPrototypeOf(t);}, _getPrototypeOf(t);}var _UiNode;function _classPrivateFieldLooseBase(e, t) {if (!{}.hasOwnProperty.call(e, t)) throw new TypeError("attempted to use private field on non-instance");return e;} // `soundor:ui` — the plugin view's node tree, its layout and its input.
  //
  // Embedded into the native runtime at build time. The native side
  // (`soundor:internal/ui`) owns the tree, lays it out with Yoga and routes the
  // view's input; this layer gives plugin code DOM-like nodes: EventTargets
  // whose events capture and bubble along the tree, with Web event classes.
  //
  // Nodes are views (flexbox boxes), text, images, scroll views and text
  // inputs; the native renderer (Skia) draws them. Text inputs edit themselves
  // as the default action of the key, text and pointer events they receive.
  //
  // A node lives as long as JavaScript can reach it. The root is always
  // reachable, and so is everything attached to it; a detached node nobody
  // references is released, natively too, when it is garbage collected.
  var CONSTRUCTING = Symbol('constructing');var CSS_PIXELS = /^-?(\d+\.?\d*|\.\d+)px$/; /** A CSS pixel length ('120px') as the number Soundor's lengths are. */function cssPixel(value) {return typeof value === 'string' && value.endsWith('px') &&
    CSS_PIXELS.test(value) ?
    Number.parseFloat(value) :
    value;
  }

  /** `style` with CSS pixel lengths as numbers. */
  function cssPixels(style) {
    var result = {};
    for (var key in style)
    if (Object.hasOwn(style, key)) result[key] = cssPixel(style[key]);
    return result;
  }

  /** Whether two styles have the same properties with the same values. */
  function sameStyle(a, b) {
    var count = 0;
    for (var key in b) {
      if (!Object.hasOwn(b, key)) continue;
      if (!Object.hasOwn(a, key) || a[key] !== b[key]) return false;
      count++;
    }
    for (var _key in a) if (Object.hasOwn(a, _key)) count--;
    return count === 0;
  }

  /** Whether assigning `value` to a style property removes it. */
  function removes(value) {
    return value === '' || value === null || value === undefined;
  }

  /** `style` with `key` set to `value`, or without it for '', null or undefined. */
  function withProperty(style, key, value) {
    var next = { ...style };
    if (removes(value)) delete next[key];else
    next[key] = value;
    return next;
  }
  /** The native node types, by name. */
  var TYPES = ['view', 'text', 'image', 'scroll', 'input', 'canvas'];

  /** The roles `accessibility.role` names. */
  var ROLES = new Set([
  'none',
  'text',
  'image',
  'button',
  'link',
  'adjustable',
  'checkbox',
  'switch',
  'togglebutton',
  'radio',
  'radiogroup',
  'progressbar',
  'search',
  'combobox',
  'menu',
  'menubar',
  'menuitem',
  'scrollbar',
  'spinbutton',
  'tab',
  'tablist',
  'header',
  'summary',
  'keyboardkey',
  'timer',
  'toolbar',
  'alert',
  'dialog']
  );

  /** id → WeakRef<UiNode>, to find event targets. */
  var nodes = new Map();
  var released = new FinalizationRegistry((id) => {
    nodes.delete(id);
    // A canvas's 2D context goes with it.
    native.release2d(id, 0);
    native.releaseNode(id);
  });

  var internals;

  function describe(value) {
    if (value === null) return 'null';
    if (typeof value === 'object') return value.constructor?.name ?? 'object';
    return typeof value;
  }

  function expectNode(value, what) {
    if (!(value instanceof UiNode)) {
      throw new TypeError(`${what} must be a UiNode, got ${describe(value)}`);
    }
    return value;
  }

  function expectType(value, type, what) {
    if (typeof value !== type)
    throw new TypeError(`${what}: expected a ${type}, got ${describe(value)}`);
    return value;
  }

  /**
   * Checks `accessibility` and fills in what the native side reads: every key,
   * null where unset.
   */
  function normalizeAccessibility(value) {
    var given = value ?? {};
    if (typeof given !== 'object')
    throw new TypeError(
      `accessibility must be an object, got ${describe(value)}`
    );
    var optional = (object, key, type, path) =>
    object[key] === undefined || object[key] === null ?
    null :
    expectType(object[key], type, `${path}.${key}`);
    var role = optional(given, 'role', 'string', 'accessibility');
    if (role !== null && !ROLES.has(role))
    throw new TypeError(`accessibility.role: unknown role '${role}'`);
    var state = given.state ?? {};
    if (typeof state !== 'object')
    throw new TypeError(
      `accessibility.state: expected an object, got ${describe(state)}`
    );
    var checked = state.checked ?? null;
    if (checked !== null && typeof checked !== 'boolean' && checked !== 'mixed')
    throw new TypeError(
      `accessibility.state.checked: expected a boolean or 'mixed', got ${describe(checked)}`
    );
    var range = given.value ?? {};
    if (typeof range !== 'object')
    throw new TypeError(
      `accessibility.value: expected an object, got ${describe(range)}`
    );
    var number = (key) => {
      var at = optional(range, key, 'number', 'accessibility.value');
      if (at !== null && !Number.isFinite(at))
      throw new TypeError(
        `accessibility.value.${key}: expected a finite number, got ${at}`
      );
      return at;
    };
    var actions = given.actions ?? [];
    if (!Array.isArray(actions))
    throw new TypeError(
      `accessibility.actions: expected an array, got ${describe(actions)}`
    );
    return {
      accessible: optional(given, 'accessible', 'boolean', 'accessibility'),
      role,
      label: optional(given, 'label', 'string', 'accessibility') ?? '',
      hint: optional(given, 'hint', 'string', 'accessibility') ?? '',
      state: {
        disabled:
        optional(state, 'disabled', 'boolean', 'accessibility.state') ?? false,
        busy: optional(state, 'busy', 'boolean', 'accessibility.state') ?? false,
        checked,
        selected: optional(state, 'selected', 'boolean', 'accessibility.state'),
        expanded: optional(state, 'expanded', 'boolean', 'accessibility.state')
      },
      value: {
        min: number('min'),
        max: number('max'),
        now: number('now'),
        text: optional(range, 'text', 'string', 'accessibility.value') ?? ''
      },
      actions: actions.map((action, i) => {
        var path = `accessibility.actions[${i}]`;
        if (typeof action !== 'object' || action === null)
        throw new TypeError(
          `${path}: expected an object, got ${describe(action)}`
        );
        var name = expectType(action.name, 'string', `${path}.name`);
        if (name === '') throw new TypeError(`${path}.name: must not be empty`);
        return { name, label: optional(action, 'label', 'string', path) ?? '' };
      }),
      modal: optional(given, 'modal', 'boolean', 'accessibility') ?? false
    };
  }

  /** A frozen copy of what plugin code gave as `accessibility`. */
  function freezeAccessibility(value) {
    var copy = { ...value };
    if (copy.state !== undefined) copy.state = Object.freeze({ ...copy.state });
    if (copy.value !== undefined) copy.value = Object.freeze({ ...copy.value });
    if (copy.actions !== undefined)
    copy.actions = Object.freeze(
      copy.actions.map((action) => Object.freeze({ ...action }))
    );
    return Object.freeze(copy);
  }var _id = Symbol("id");var _type = Symbol("type");var _parent = Symbol("parent");var _children = Symbol("children");var _style = Symbol("style");var _styleView = Symbol("styleView");var _text = Symbol("text");var _focusable = Symbol("focusable");var _source = Symbol("source");var _placeholder = Symbol("placeholder");var _accessibility = Symbol("accessibility");var _accessibilityParent = Symbol("accessibilityParent");var _canvasWidth = Symbol("canvasWidth");var _canvasHeight = Symbol("canvasHeight");var _context = Symbol("context");var _resize = Symbol("resize");var _expect = Symbol("expect");var

  UiNode = exports.UiNode = /*#__PURE__*/function (_EventTarget) {

















    /** Nodes are made with createView(), createText() and the like. */
    function UiNode(token, _type2, id) {var _this;_classCallCheck(this, UiNode);
      if (token !== CONSTRUCTING) {
        throw new TypeError(
          'Illegal constructor: use createView(), createText() and the like'
        );
      }
      _this = _callSuper(this, UiNode);Object.defineProperty(_this, _expect, { value: _expect2 });Object.defineProperty(_this, _resize, { value: _resize2 });Object.defineProperty(_this, _id, { writable: true, value: void 0 });Object.defineProperty(_this, _type, { writable: true, value: void 0 });Object.defineProperty(_this, _parent, { writable: true, value: null });Object.defineProperty(_this, _children, { writable: true, value: [] });Object.defineProperty(_this, _style, { writable: true, value: Object.freeze({}) });Object.defineProperty(_this, _styleView, { writable: true, value: null });Object.defineProperty(_this, _text, { writable: true, value: '' });Object.defineProperty(_this, _focusable, { writable: true, value: false });Object.defineProperty(_this, _source, { writable: true, value: '' });Object.defineProperty(_this, _placeholder, { writable: true, value: '' });Object.defineProperty(_this, _accessibility, { writable: true, value: Object.freeze({}) });Object.defineProperty(_this, _accessibilityParent, { writable: true, value: null }); // Canvas nodes: the drawing buffer's size, and the context made for it.
      Object.defineProperty(_this, _canvasWidth, { writable: true, value: 300 });Object.defineProperty(_this, _canvasHeight, { writable: true, value: 150 });Object.defineProperty(_this, _context, { writable: true, value: null });_this[_type] = _type2;
      _this[_id] = id;
      nodes.set(id, new WeakRef(_this));return _this;
    }

    /** 'view', 'text', 'image', 'scroll', 'input' or 'canvas'. */_inherits(UiNode, _EventTarget);return _createClass(UiNode, [{ key: "type", get:
      function () {
        return this[_type];
      } }, { key: "parent", get:

      function () {
        return this[_parent];
      }

      /** A snapshot of the children, in order. */ }, { key: "children", get:
      function () {
        return Object.freeze([...this[_children]]);
      } }, { key: "firstChild", get:

      function () {
        return this[_children][0] ?? null;
      } }, { key: "lastChild", get:

      function () {
        return this[_children].at(-1) ?? null;
      } }, { key: "nextSibling", get:

      function () {var _classPrivateFieldLoo;
        var siblings = (_classPrivateFieldLoo = this[_parent]) === null || _classPrivateFieldLoo === void 0 ? void 0 : _classPrivateFieldLoo[_children];
        return siblings?.[siblings.indexOf(this) + 1] ?? null;
      } }, { key: "previousSibling", get:

      function () {var _classPrivateFieldLoo2;
        var siblings = (_classPrivateFieldLoo2 = this[_parent]) === null || _classPrivateFieldLoo2 === void 0 ? void 0 : _classPrivateFieldLoo2[_children];
        return siblings?.[siblings.indexOf(this) - 1] ?? null;
      }

      /** Whether the node is in one of the view's trees. */ }, { key: "isConnected", get:
      function () {
        var node = this;
        while (node[_parent] !== null) node = node[_parent];
        return node === root || node === overlayRoot;
      }

      /** The style last set; assigning replaces it as a whole. */
      /**
       * The node's style. Setting it replaces the whole style; setting one of its
       * properties (`node.style.width = 120`, as on the Web) restyles the node with
       * that property changed, and '' or null removes it. Lengths may be written
       * as CSS pixels ('120px').
       */ }, { key: "style", get:
      function () {
        this[_styleView] ??= new Proxy(
          {},
          {
            get: (_, key) => this[_style][key],
            has: (_, key) => key in this[_style],
            ownKeys: () => Reflect.ownKeys(this[_style]),
            getOwnPropertyDescriptor: (_, key) =>
            Object.hasOwn(this[_style], key) ?
            {
              value: this[_style][key],
              writable: true,
              enumerable: true,
              configurable: true
            } :
            undefined,
            set: (_, key, value) => {
              // What it already is (or not there to remove): nothing to do.
              var unchanged = removes(value) ?
              !Object.hasOwn(this[_style], key) :
              Object.hasOwn(this[_style], key) &&
              this[_style][key] === cssPixel(value);
              if (!unchanged) this.style = withProperty(this[_style], key, value);
              return true;
            },
            deleteProperty: (_, key) => {
              if (Object.hasOwn(this[_style], key))
              this.style = withProperty(this[_style], key, null);
              return true;
            },
            defineProperty: () => false
          }
        );
        return this[_styleView];
      }, set:

      function (value) {
        var given = value ?? {};
        if (typeof given !== 'object') {
          throw new TypeError(`style must be an object, got ${describe(value)}`);
        }
        var style = cssPixels(given);
        // The same style again: it was valid, and nothing would change.
        if (sameStyle(this[_style], style)) return;
        native.setStyle(this[_id], style);
        this[_style] = Object.freeze(style);
      }

      /** The text of a text node, or the value of an input. */ }, { key: "text", get:
      function () {
        return this[_text];
      }, set:

      function (value) {
        if (this[_type] !== 'text' && this[_type] !== 'input') {
          throw new TypeError('only text and input nodes have text');
        }
        var text = String(value);
        native.setText(this[_id], text);
        this[_text] = text;
      }

      /** An input's text. */ }, { key: "value", get:
      function () {
        this[_expect]('input', 'value');
        return this[_text];
      }, set:

      function (value) {
        this[_expect]('input', 'value');
        this.text = value;
        // Like the DOM: setting the value puts the caret at its end.
        this.setSelectionRange(this[_text].length, this[_text].length);
      }

      /** An input's hint, shown while it is empty. */ }, { key: "placeholder", get:
      function () {
        this[_expect]('input', 'placeholder');
        return this[_placeholder];
      }, set:

      function (value) {
        this[_expect]('input', 'placeholder');
        this[_placeholder] = String(value);
        native.setPlaceholder(this[_id], this[_placeholder]);
      } }, { key: "selectionStart", get:

      function () {
        this[_expect]('input', 'selectionStart');
        var { anchor, focus } = native.selection(this[_id]);
        return Math.min(anchor, focus);
      } }, { key: "selectionEnd", get:

      function () {
        this[_expect]('input', 'selectionEnd');
        var { anchor, focus } = native.selection(this[_id]);
        return Math.max(anchor, focus);
      } }, { key: "selectionDirection", get:

      function () {
        this[_expect]('input', 'selectionDirection');
        var { anchor, focus } = native.selection(this[_id]);
        return focus < anchor ? 'backward' : 'forward';
      }

      /** Selects [start, end) of an input's text (UTF-16 indices). */ }, { key: "setSelectionRange", value:
      function setSelectionRange(start, end, direction = 'forward') {
        this[_expect]('input', 'setSelectionRange()');
        var from = Math.max(0, Math.min(Number(start) || 0, this[_text].length));
        var to = Math.max(from, Math.min(Number(end) || 0, this[_text].length));
        if (direction === 'backward') native.setSelection(this[_id], to, from);else
        native.setSelection(this[_id], from, to);
      } }, { key: "select", value:

      function select() {
        this.setSelectionRange(0, this[_text].length);
      }

      /** An image's asset id (what `import logo from './logo.png'` yields). */ }, { key: "source", get:
      function () {
        this[_expect]('image', 'source');
        return this[_source];
      }, set:

      function (value) {
        this[_expect]('image', 'source');
        this[_source] = value === null || value === undefined ? '' : String(value);
        native.setSource(this[_id], this[_source]);
      }

      /**
       * A canvas's drawing buffer, in pixels (300 by 150 to begin with, as on
       * the Web); shown stretched over the node's box. Setting either clears the
       * canvas and resets its context's state, even to the same value.
       */ }, { key: "width", get:
      function () {
        this[_expect]('canvas', 'width');
        return this[_canvasWidth];
      }, set:

      function (value) {
        this[_expect]('canvas', 'width');
        this[_resize](value, this[_canvasHeight], 300, true);
      } }, { key: "height", get:

      function () {
        this[_expect]('canvas', 'height');
        return this[_canvasHeight];
      }, set:

      function (value) {
        this[_expect]('canvas', 'height');
        this[_resize](this[_canvasWidth], value, 150, false);
      } }, { key: "getContext", value:















      /**
       * A canvas's drawing context: '2d' (CanvasRenderingContext2D, drawn with
       * Skia on the CPU) or 'webgl2' (WebGL2RenderingContext, on the GPU; null
       * where there is no acceptable GPU). The same object every time; null for
       * other types, and for a type other than the one the canvas already has,
       * as on the Web.
       */
      function getContext(type, options = {}) {
        this[_expect]('canvas', 'getContext()');
        var kind = String(type);
        if (this[_context] !== null)
        return this[_context].kind === kind ? this[_context].value : null;
        if (kind === 'webgl2') {
          var context = (0, _webgl.createWebGL2)(this, this[_id], options);
          // No GPU: null, and null again later (but '2d' may still be had).
          if (context !== null) this[_context] = { kind, value: context };
          return context;
        }
        if (kind !== '2d') return null;
        var settings = options ?? {};
        if (settings.alpha === false)
        throw new TypeError(
          "getContext('2d', { alpha: false }) is not supported by Soundor's 2D canvas"
        );
        if (settings.colorSpace !== undefined && settings.colorSpace !== 'srgb')
        throw new TypeError(
          `getContext('2d') with colorSpace '${settings.colorSpace}' is not supported by Soundor's 2D canvas`
        );
        this[_context] = { kind, value: (0, _canvas.createContext2D)(this, this[_id]) };
        return this[_context].value;
      }

      /** How far a scroll view's content is scrolled. */ }, { key: "scrollTop", get:
      function () {
        return native.scrollOffset(this[_id]).y;
      }, set:

      function (value) {
        this.scrollTo({ top: value });
      } }, { key: "scrollLeft", get:

      function () {
        return native.scrollOffset(this[_id]).x;
      }, set:

      function (value) {
        this.scrollTo({ left: value });
      }

      /** The size of what a scroll view scrolls. */ }, { key: "scrollWidth", get:
      function () {
        return native.contentSize(this[_id]).width;
      } }, { key: "scrollHeight", get:

      function () {
        return native.contentSize(this[_id]).height;
      }

      /** scrollTo({ top, left }) or scrollTo(left, top); clamped to the content. */ }, { key: "scrollTo", value:
      function scrollTo(optionsOrLeft, top) {
        this[_expect]('scroll', 'scrollTo()');
        var current = native.scrollOffset(this[_id]);
        var target =
        typeof optionsOrLeft === 'object' && optionsOrLeft !== null ?
        {
          x: optionsOrLeft.left ?? current.x,
          y: optionsOrLeft.top ?? current.y
        } :
        { x: optionsOrLeft ?? current.x, y: top ?? current.y };
        native.scrollTo(this[_id], Number(target.x) || 0, Number(target.y) || 0);
      } }, { key: "scrollBy", value:

      function scrollBy(optionsOrLeft, top) {
        var current = native.scrollOffset(this[_id]);
        var delta =
        typeof optionsOrLeft === 'object' && optionsOrLeft !== null ?
        { x: optionsOrLeft.left ?? 0, y: optionsOrLeft.top ?? 0 } :
        { x: optionsOrLeft ?? 0, y: top ?? 0 };
        this.scrollTo(current.x + Number(delta.x), current.y + Number(delta.y));
      } }, { key: "accessibility", get:







      /** What the node is to assistive technology; assigning replaces it. */
      function () {
        return this[_accessibility];
      }, set:

      function (value) {
        native.setAccessibility(this[_id], normalizeAccessibility(value));
        this[_accessibility] = freezeAccessibility(value ?? {});
      }

      /**
       * Where assistive technology reads the node, in place of its parent (null:
       * its parent): content a portal shows elsewhere than where it belongs.
       */ }, { key: "accessibilityParent", get:
      function () {
        return this[_accessibilityParent];
      }, set:

      function (value) {
        if (value !== null && value !== undefined)
        expectNode(value, 'accessibilityParent');
        var parent = value ?? null;
        native.setAccessibilityParent(this[_id], (parent === null || parent === void 0 ? void 0 : parent[_id]) ?? 0);
        this[_accessibilityParent] = parent;
      }

      /** Whether the node takes focus when pressed or tabbed to. */ }, { key: "focusable", get:
      function () {
        return this[_focusable];
      }, set:

      function (value) {
        this[_focusable] = Boolean(value);
        native.setFocusable(this[_id], this[_focusable]);
      } }, { key: "focused", get:

      function () {
        return native.focused() === this[_id];
      } }, { key: "focus", value:

      function focus() {
        native.focus(this[_id]);
      } }, { key: "blur", value:

      function blur() {
        if (this.focused) native.focus(0);
      } }, { key: "appendChild", value:

      function appendChild(child) {
        return this.insertBefore(child, null);
      } }, { key: "insertBefore", value:

      function insertBefore(child, before) {
        expectNode(child, 'child');
        if (before !== null && before !== undefined) expectNode(before, 'before');
        native.insertChild(this[_id], child[_id], (before === null || before === void 0 ? void 0 : before[_id]) ?? 0);
        if (child === before) return child;
        if (child[_parent] !== null) {
          var siblings = child[_parent][_children];
          siblings.splice(siblings.indexOf(child), 1);
        }
        var index = before ? this[_children].indexOf(before) : -1;
        if (index < 0) this[_children].push(child);else
        this[_children].splice(index, 0, child);
        child[_parent] = this;
        return child;
      } }, { key: "removeChild", value:

      function removeChild(child) {
        expectNode(child, 'child');
        native.removeChild(this[_id], child[_id]);
        this[_children].splice(this[_children].indexOf(child), 1);
        child[_parent] = null;
        return child;
      }

      /** Removes the node from its parent, if it has one. */ }, { key: "remove", value:
      function remove() {
        this[_parent]?.removeChild(this);
      } }, { key: "contains", value:

      function contains(other) {
        for (var node = other; node; node = node[_parent]) {
          if (node === this) return true;
        }
        return false;
      }

      /** The laid-out box relative to the parent's. */ }, { key: "layout", get:
      function () {
        return native.frame(this[_id]);
      }

      /** The laid-out box relative to the view (zero when not connected). */ }, { key: "getBoundingClientRect", value:
      function getBoundingClientRect() {
        return native.bounds(this[_id]);
      } }, { key:

      _events.eventParent, value: function () {
        return this[_parent];
      } }]);}(_events.EventTarget);_UiNode = UiNode;function _resize2(width, height, fallback, horizontal) {var size = Math.trunc(Number(horizontal ? width : height));var valid = size >= 0 ? size : fallback;var [w, h] = horizontal ? [valid, this[_canvasHeight]] : [this[_canvasWidth], valid];native.setCanvasSize(this[_id], w, h);this[_canvasWidth] = w;this[_canvasHeight] = h;if (this[_context]?.kind === '2d') (0, _canvas.resetContext)(this[_context].value);else if (this[_context]?.kind === 'webgl2' && this[_context].value !== null) (0, _webgl.resizeWebGL)(this[_context].value);}function _expect2(type, what) {if (this[_type] !== type) {throw new TypeError(`${what} belongs to ${type} nodes`);}}(() => {


    (0, _canvas.setSourceResolver)((value) => {
      if (!(value instanceof _UiNode)) return null;
      if (value[_type] === 'canvas')
      return {
        kind: 'canvas',
        id: value[_id],
        width: value[_canvasWidth],
        height: value[_canvasHeight]
      };
      if (value[_type] === 'image')
      return { kind: 'image', asset: value[_source] };
      return null;
    });
    internals = {
      id: (node) => node[_id],
      setFocusableState(node, value) {
        node[_focusable] = value;
      }
    };})();



  function create(type) {
    var node = new UiNode(
      CONSTRUCTING,
      type,
      native.createNode(TYPES.indexOf(type))
    );
    released.register(node, internals.id(node));
    return node;
  }

  /** A new, detached view: a box laid out with flexbox. */
  function createView(style) {
    var node = create('view');
    if (style !== undefined) node.style = style;
    return node;
  }

  /** A new, detached text node. */
  function createText(text = '', style) {
    var node = create('text');
    if (text !== '') node.text = text;
    if (style !== undefined) node.style = style;
    return node;
  }

  /** A new, detached image showing a bundled asset. */
  function createImage(source = '', style) {
    var node = create('image');
    if (source !== '') node.source = source;
    if (style !== undefined) node.style = style;
    return node;
  }

  /** A new, detached view whose children scroll (by wheel, or scrollTo()). */
  function createScrollView(style) {
    var node = create('scroll');
    if (style !== undefined) node.style = style;
    return node;
  }

  /** A new, detached single-line text input. It is focusable. */
  function createTextInput(options = {}) {
    var node = create('input');
    internals.setFocusableState(node, true);
    if (options.value !== undefined) node.value = options.value;
    if (options.placeholder !== undefined) node.placeholder = options.placeholder;
    if (options.style !== undefined) node.style = options.style;
    return node;
  }

  /**
   * A new, detached canvas: pixels code draws with getContext('2d'), 300 by
   * 150 until its width and height say otherwise. Its box is that size in
   * logical pixels unless its style sizes it.
   */
  function createCanvas(style) {
    var node = create('canvas');
    if (style !== undefined) node.style = style;
    return node;
  }










  /** The view's root node; it always fills the view. */
  var root = exports.root = new UiNode(CONSTRUCTING, 'view', native.rootId);

  /**
   * The view's overlay layer: a second root that fills the view, drawn over
   * root and everything in it and hit first, letting pointer events through
   * where nothing in it takes them.
   */
  var overlayRoot = exports.overlayRoot = new UiNode(CONSTRUCTING, 'view', native.overlayId);

  /** The view's size in logical pixels, and device pixels per logical pixel. */
  function viewSize() {
    return native.size();
  }

  /** The node that has keyboard focus, if any. */
  function focusedNode() {
    return nodes.get(native.focused())?.deref() ?? null;
  }

  /** The system clipboard's text (navigator.clipboard's shape). */
  var clipboard = exports.clipboard = Object.freeze({
    readText: function () {var _readText = _asyncToGenerator(function* () {return native.readClipboard();});function readText() {return _readText.apply(this, arguments);}return readText;}(),
    writeText: function () {var _writeText = _asyncToGenerator(function* (text) {return native.writeClipboard(String(text));});function writeText(_x) {return _writeText.apply(this, arguments);}return writeText;}()
  });

  /** How long a press lasts before it is a long press, by default (ms). */
  var LONG_PRESS_DELAY = 500;
  /** How far a press may move (logical pixels) and still be a long press. */
  var LONG_PRESS_SLOP = 10;

  /**
   * Makes `node` pressable: press with the primary button (released over it)
   * or, when focused, with Enter or Space; hold it for a long press. Reports
   * the pressed, hovered and focused state as it changes. Returns a function
   * that undoes it.
   */
  function pressable(node, handlers = {}) {
    expectNode(node, 'node');
    var state = { pressed: false, hovered: false, focused: node.focused };
    var update = (change) => {
      var next = { ...state, ...change };
      if (
      next.pressed === state.pressed &&
      next.hovered === state.hovered &&
      next.focused === state.focused)

      return;
      Object.assign(state, next);
      handlers.onStateChange?.({ ...state });
    };
    var controller = new AbortController();
    var { signal } = controller;
    var on = (type, listener) =>
    node.addEventListener(type, listener, { signal });

    // A long press: the press held, close to where it started, until a timer.
    var longPress = null;
    var longPressed = false;
    var cancelLongPress = () => {
      if (longPress !== null) clearTimeout(longPress.timer);
      longPress = null;
    };
    signal.addEventListener('abort', cancelLongPress);

    on('pointerdown', (event) => {
      if (event.button !== 0) return;
      cancelLongPress();
      longPressed = false;
      update({ pressed: true });
      handlers.onPressIn?.(event);
      if (handlers.onLongPress !== undefined && state.pressed) {
        var delay = handlers.delayLongPress ?? LONG_PRESS_DELAY;
        longPress = {
          x: event.pageX,
          y: event.pageY,
          timer: setTimeout(() => {
            longPress = null;
            if (!state.pressed) return;
            longPressed = true;
            handlers.onLongPress?.(event);
          }, delay)
        };
      }
    });
    on('pointermove', (event) => {
      if (longPress === null) return;
      var moved = Math.hypot(
        event.pageX - longPress.x,
        event.pageY - longPress.y
      );
      if (moved > LONG_PRESS_SLOP) cancelLongPress();
    });
    on('pointerup', (event) => {
      cancelLongPress();
      if (!state.pressed) return;
      update({ pressed: false });
      handlers.onPressOut?.(event);
    });
    on('pointercancel', (event) => {
      cancelLongPress();
      longPressed = false;
      if (!state.pressed) return;
      update({ pressed: false });
      handlers.onPressOut?.(event);
    });
    on('click', (event) => {
      // A long press is not also a press.
      if (longPressed) {
        longPressed = false;
        return;
      }
      handlers.onPress?.(event);
    });
    on('pointerenter', (event) => {
      update({ hovered: true });
      handlers.onHoverIn?.(event);
    });
    on('pointerleave', (event) => {
      update({ hovered: false });
      handlers.onHoverOut?.(event);
    });
    on('focus', () => update({ focused: true }));
    on('blur', () => update({ focused: false }));
    // Assistive technology presses without the pointer or the keyboard.
    on('accessibilityaction', (event) => {
      if (event.target !== node || event.defaultPrevented) return;
      if (event.actionName === 'activate') {
        event.preventDefault();
        handlers.onPress?.(event);
      } else if (
      event.actionName === 'longpress' &&
      handlers.onLongPress !== undefined)
      {
        event.preventDefault();
        handlers.onLongPress(event);
      }
    });
    on('keydown', (event) => {
      if (event.target !== node || event.repeat) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      handlers.onPress?.(event);
    });
    node.focusable = true;
    return () => controller.abort();
  }

  // ── Events ───────────────────────────────────────────────────────────────────

  var SHIFT = 1;
  var CONTROL = 2;
  var ALT = 4;
  var META = 8;var _modifiers = Symbol("modifiers");var

  ModifierEvent = /*#__PURE__*/function (_Event) {


    function ModifierEvent(type, init = {}) {var _this2;_classCallCheck(this, ModifierEvent);
      _this2 = _callSuper(this, ModifierEvent, [type, init]);Object.defineProperty(_this2, _modifiers, { writable: true, value: void 0 });
      _this2[_modifiers] =
      (init.shiftKey ? SHIFT : 0) | (
      init.ctrlKey ? CONTROL : 0) | (
      init.altKey ? ALT : 0) | (
      init.metaKey ? META : 0);return _this2;
    }_inherits(ModifierEvent, _Event);return _createClass(ModifierEvent, [{ key: "shiftKey", get:

      function () {
        return (this[_modifiers] & SHIFT) !== 0;
      } }, { key: "ctrlKey", get:
      function () {
        return (this[_modifiers] & CONTROL) !== 0;
      } }, { key: "altKey", get:
      function () {
        return (this[_modifiers] & ALT) !== 0;
      } }, { key: "metaKey", get:
      function () {
        return (this[_modifiers] & META) !== 0;
      } }, { key: "getModifierState", value:

      function getModifierState(key) {
        switch (key) {
          case 'Shift':
            return this.shiftKey;
          case 'Control':
            return this.ctrlKey;
          case 'Alt':
            return this.altKey;
          case 'Meta':
            return this.metaKey;
          default:
            return false;
        }
      } }]);}(_events.Event);var _init = Symbol("init");var


  PointerEvent = exports.PointerEvent = /*#__PURE__*/function (_ModifierEvent2) {


    function PointerEvent(type, init = {}) {var _this3;_classCallCheck(this, PointerEvent);
      _this3 = _callSuper(this, PointerEvent, [type, init]);Object.defineProperty(_this3, _init, { writable: true, value: void 0 });
      _this3[_init] = {
        clientX: init.clientX ?? 0,
        clientY: init.clientY ?? 0,
        offsetX: init.offsetX ?? 0,
        offsetY: init.offsetY ?? 0,
        button: init.button ?? 0,
        buttons: init.buttons ?? 0,
        pointerId: init.pointerId ?? 0,
        pointerType: init.pointerType ?? '',
        pressure: init.pressure ?? 0,
        isPrimary: init.isPrimary ?? false,
        relatedTarget: init.relatedTarget ?? null
      };return _this3;
    }

    /** Relative to the view's top-left corner, in logical pixels. */_inherits(PointerEvent, _ModifierEvent2);return _createClass(PointerEvent, [{ key: "pageX", get:
      function () {
        return this[_init].clientX;
      } }, { key: "pageY", get:
      function () {
        return this[_init].clientY;
      }
      /** Relative to the target's box, in logical pixels. */ }, { key: "locationX", get:
      function () {
        return this[_init].offsetX;
      } }, { key: "locationY", get:
      function () {
        return this[_init].offsetY;
      }
      /** pageX and pageY, by their Web names. */ }, { key: "clientX", get:
      function () {
        return this[_init].clientX;
      } }, { key: "clientY", get:
      function () {
        return this[_init].clientY;
      } }, { key: "x", get:
      function () {
        return this[_init].clientX;
      } }, { key: "y", get:
      function () {
        return this[_init].clientY;
      }
      /** locationX and locationY, by their Web names. */ }, { key: "offsetX", get:
      function () {
        return this[_init].offsetX;
      } }, { key: "offsetY", get:
      function () {
        return this[_init].offsetY;
      } }, { key: "button", get:
      function () {
        return this[_init].button;
      } }, { key: "buttons", get:
      function () {
        return this[_init].buttons;
      } }, { key: "pointerId", get:
      function () {
        return this[_init].pointerId;
      } }, { key: "pointerType", get:
      function () {
        return this[_init].pointerType;
      } }, { key: "pressure", get:
      function () {
        return this[_init].pressure;
      } }, { key: "isPrimary", get:
      function () {
        return this[_init].isPrimary;
      } }, { key: "relatedTarget", get:
      function () {
        return this[_init].relatedTarget;
      } }]);}(ModifierEvent);var _deltaX = Symbol("deltaX");var _deltaY = Symbol("deltaY");var _deltaMode = Symbol("deltaMode");var


  WheelEvent = exports.WheelEvent = /*#__PURE__*/function (_PointerEvent2) {




    function WheelEvent(type, init = {}) {var _this4;_classCallCheck(this, WheelEvent);
      _this4 = _callSuper(this, WheelEvent, [type, init]);Object.defineProperty(_this4, _deltaX, { writable: true, value: void 0 });Object.defineProperty(_this4, _deltaY, { writable: true, value: void 0 });Object.defineProperty(_this4, _deltaMode, { writable: true, value: void 0 });
      _this4[_deltaX] = init.deltaX ?? 0;
      _this4[_deltaY] = init.deltaY ?? 0;
      _this4[_deltaMode] = init.deltaMode ?? 0;return _this4;
    }_inherits(WheelEvent, _PointerEvent2);return _createClass(WheelEvent, [{ key: "deltaX", get:

      function () {
        return this[_deltaX];
      } }, { key: "deltaY", get:
      function () {
        return this[_deltaY];
      } }, { key: "deltaZ", get:
      function () {
        return 0;
      }
      /** 0: pixels, 1: lines. */ }, { key: "deltaMode", get:
      function () {
        return this[_deltaMode];
      } }]);}(PointerEvent);

  WheelEvent.DOM_DELTA_PIXEL = 0;
  WheelEvent.DOM_DELTA_LINE = 1;
  WheelEvent.DOM_DELTA_PAGE = 2;var _key2 = Symbol("key");var _repeat = Symbol("repeat");var

  KeyboardEvent = exports.KeyboardEvent = /*#__PURE__*/function (_ModifierEvent3) {



    function KeyboardEvent(type, init = {}) {var _this5;_classCallCheck(this, KeyboardEvent);
      _this5 = _callSuper(this, KeyboardEvent, [type, init]);Object.defineProperty(_this5, _key2, { writable: true, value: void 0 });Object.defineProperty(_this5, _repeat, { writable: true, value: void 0 });
      _this5[_key2] = init.key ?? '';
      _this5[_repeat] = Boolean(init.repeat);return _this5;
    }_inherits(KeyboardEvent, _ModifierEvent3);return _createClass(KeyboardEvent, [{ key: "key", get:

      function () {
        return this[_key2];
      } }, { key: "repeat", get:
      function () {
        return this[_repeat];
      } }]);}(ModifierEvent);var _relatedTarget = Symbol("relatedTarget");var


  FocusEvent = exports.FocusEvent = /*#__PURE__*/function (_Event2) {


    function FocusEvent(type, init = {}) {var _this6;_classCallCheck(this, FocusEvent);
      _this6 = _callSuper(this, FocusEvent, [type, init]);Object.defineProperty(_this6, _relatedTarget, { writable: true, value: void 0 });
      _this6[_relatedTarget] = init.relatedTarget ?? null;return _this6;
    }_inherits(FocusEvent, _Event2);return _createClass(FocusEvent, [{ key: "relatedTarget", get:

      function () {
        return this[_relatedTarget];
      } }]);}(_events.Event);var _data = Symbol("data");var _inputType = Symbol("inputType");var


  InputEvent = exports.InputEvent = /*#__PURE__*/function (_Event3) {



    function InputEvent(type, init = {}) {var _this7;_classCallCheck(this, InputEvent);
      _this7 = _callSuper(this, InputEvent, [type, init]);Object.defineProperty(_this7, _data, { writable: true, value: void 0 });Object.defineProperty(_this7, _inputType, { writable: true, value: void 0 });
      _this7[_data] = init.data ?? null;
      _this7[_inputType] = init.inputType ?? '';return _this7;
    }_inherits(InputEvent, _Event3);return _createClass(InputEvent, [{ key: "data", get:

      function () {
        return this[_data];
      } }, { key: "inputType", get:
      function () {
        return this[_inputType];
      } }]);}(_events.Event);


  /** An action assistive technology asks of a node (`accessibilityaction`). */var _actionName = Symbol("actionName");var _value = Symbol("value");var
  AccessibilityActionEvent = exports.AccessibilityActionEvent = /*#__PURE__*/function (_Event4) {



    function AccessibilityActionEvent(type, init = {}) {var _this8;_classCallCheck(this, AccessibilityActionEvent);
      _this8 = _callSuper(this, AccessibilityActionEvent, [type, init]);Object.defineProperty(_this8, _actionName, { writable: true, value: void 0 });Object.defineProperty(_this8, _value, { writable: true, value: void 0 });
      _this8[_actionName] = String(init.actionName ?? '');
      _this8[_value] = init.value;return _this8;
    }

    /** 'activate', 'increment', 'setValue'... or a custom action's name. */_inherits(AccessibilityActionEvent, _Event4);return _createClass(AccessibilityActionEvent, [{ key: "actionName", get:
      function () {
        return this[_actionName];
      }
      /** setValue: the value asked for (a number, or an input's text). */ }, { key: "value", get:
      function () {
        return this[_value];
      } }]);}(_events.Event);


  /** By the native event type: [name, class, bubbles, cancelable]. */
  var EVENT_TYPES = [
  ['pointerdown', PointerEvent, true, true],
  ['pointermove', PointerEvent, true, true],
  ['pointerup', PointerEvent, true, true],
  ['pointercancel', PointerEvent, true, false],
  ['pointerenter', PointerEvent, false, false],
  ['pointerleave', PointerEvent, false, false],
  ['click', PointerEvent, true, true],
  ['wheel', WheelEvent, true, true],
  ['keydown', KeyboardEvent, true, true],
  ['keyup', KeyboardEvent, true, true],
  ['beforeinput', InputEvent, true, true],
  ['focus', FocusEvent, false, false],
  ['blur', FocusEvent, false, false],
  ['scroll', _events.Event, false, false],
  ['contextmenu', PointerEvent, true, true],
  ['accessibilityaction', AccessibilityActionEvent, true, true]];


  // ── Text editing: the default actions of an input's events ─────────────────

  /** Where the value was when the input last reported a change. */
  var committed = new WeakMap();

  var isLowSurrogate = (code) => code >= 0xdc00 && code <= 0xdfff;

  /** The code point boundary before `i`. */
  function previousIndex(text, i) {
    if (i <= 0) return 0;
    return i >= 2 && isLowSurrogate(text.charCodeAt(i - 1)) ? i - 2 : i - 1;
  }

  /** The code point boundary after `i`. */
  function nextIndex(text, i) {
    if (i >= text.length) return text.length;
    return isLowSurrogate(text.charCodeAt(i + 1)) ? i + 2 : i + 1;
  }

  /** Where a word-wise move from `from` lands: back (step -1) or forward. */
  function wordBoundary(text, from, step) {
    var i = from;
    if (step < 0) {
      while (i > 0 && /\s/.test(text[i - 1])) i--;
      while (i > 0 && /\S/.test(text[i - 1])) i--;
    } else {
      while (i < text.length && /\s/.test(text[i])) i++;
      while (i < text.length && /\S/.test(text[i])) i++;
    }
    return i;
  }

  function edit(input, text, caret, inputType, data = null) {
    input.text = text;
    input.setSelectionRange(caret, caret);
    input.dispatchEvent(
      (0, _events.trustEvent)(new InputEvent('input', { bubbles: true, inputType, data }))
    );
  }

  function commit(input) {
    if (committed.get(input) === input.value) return;
    committed.set(input, input.value);
    input.dispatchEvent((0, _events.trustEvent)(new _events.Event('change', { bubbles: true })));
  }

  function replaceSelection(input, data, inputType) {
    var text = input.value;
    var start = input.selectionStart;
    edit(
      input,
      text.slice(0, start) + data + text.slice(input.selectionEnd),
      start + data.length,
      inputType,
      data
    );
  }

  /** keydown on a focused input; returns whether it did something. */
  function editKey(input, event) {
    var text = input.value;
    var { selectionStart: start, selectionEnd: end } = input;
    var selection = native.selection(internals.id(input));
    var command = event.ctrlKey || event.metaKey;
    var byWord = event.ctrlKey || event.altKey;
    var move = (to) => {
      var target = Math.max(0, Math.min(to, text.length));
      if (event.shiftKey)
      native.setSelection(internals.id(input), selection.anchor, target);else
      input.setSelectionRange(target, target);
      return true;
    };
    switch (event.key) {
      case 'ArrowLeft':
        if (event.metaKey) return move(0);
        if (!event.shiftKey && start !== end) return move(start);
        return move(
          byWord ?
          wordBoundary(text, selection.focus, -1) :
          previousIndex(text, selection.focus)
        );
      case 'ArrowRight':
        if (event.metaKey) return move(text.length);
        if (!event.shiftKey && start !== end) return move(end);
        return move(
          byWord ?
          wordBoundary(text, selection.focus, 1) :
          nextIndex(text, selection.focus)
        );
      case 'Home':
      case 'ArrowUp':
        return move(0);
      case 'End':
      case 'ArrowDown':
        return move(text.length);
      case 'Backspace':
        if (start !== end) replaceSelection(input, '', 'deleteContentBackward');else
        if (start > 0) {
          var from = byWord ?
          wordBoundary(text, start, -1) :
          previousIndex(text, start);
          edit(
            input,
            text.slice(0, from) + text.slice(start),
            from,
            'deleteContentBackward'
          );
        }
        return true;
      case 'Delete':
        if (start !== end) replaceSelection(input, '', 'deleteContentForward');else
        if (start < text.length) {
          var to = byWord ?
          wordBoundary(text, start, 1) :
          nextIndex(text, start);
          edit(
            input,
            text.slice(0, start) + text.slice(to),
            start,
            'deleteContentForward'
          );
        }
        return true;
      case 'Enter':
        commit(input);
        return true;
      case 'Escape':
        return false;
    }
    if (command && !event.altKey) {
      switch (event.key.toLowerCase()) {
        case 'a':
          input.select();
          return true;
        case 'c':
          if (start !== end) native.writeClipboard(text.slice(start, end));
          return true;
        case 'x':
          if (start !== end) {
            native.writeClipboard(text.slice(start, end));
            replaceSelection(input, '', 'deleteByCut');
          }
          return true;
        case 'v':{
            var pasted = native.readClipboard().replace(/[\r\n]+/g, ' ');
            if (pasted !== '') replaceSelection(input, pasted, 'insertFromPaste');
            return true;
          }
      }
    }
    // Characters arrive as text (beforeinput) next.
    return false;
  }

  /**
   * The runtime's own response to an accessibility action plugin code left
   * alone: focus, and an input's text. Returns whether it did something.
   */
  function accessibilityDefault(target, event) {
    switch (event.actionName) {
      case 'focus':
        target.focus();
        return target.focused;
      case 'blur':
        if (!target.focused) return false;
        target.blur();
        return true;
      case 'activate':
        // Activating an input is starting to edit it.
        if (target.type !== 'input' || !target.focusable) return false;
        target.focus();
        return target.focused;
      case 'setValue':{
          if (target.type !== 'input' || typeof event.value !== 'string')
          return false;
          var text = event.value.replace(/[\r\n]+/g, ' ');
          edit(target, text, text.length, 'insertReplacementText', text);
          commit(target);
          return true;
        }
    }
    return false;
  }

  /** Runs the default action of a dispatched event; returns whether it did. */
  function defaultAction(target, event) {
    if (event.type === 'accessibilityaction')
    return accessibilityDefault(target, event);
    if (target.type !== 'input') return false;
    var id = internals.id(target);
    switch (event.type) {
      case 'keydown':
        return editKey(target, event);
      case 'beforeinput':
        replaceSelection(target, event.data ?? '', 'insertText');
        return true;
      // Placing the caret is not "handling" the press: the input still takes
      // focus from it.
      case 'pointerdown':{
          if (event.button !== 0) return false;
          var offset = native.offsetAt(id, event.offsetX, event.offsetY);
          if (event.shiftKey)
          native.setSelection(id, native.selection(id).anchor, offset);else
          native.setSelection(id, offset, offset);
          return false;
        }
      case 'pointermove':
        if ((event.buttons & 1) !== 0)
        native.setSelection(
          id,
          native.selection(id).anchor,
          native.offsetAt(id, event.offsetX, event.offsetY)
        );
        return false;
      case 'focus':
        if (!committed.has(target)) committed.set(target, target.value);
        return false;
      case 'blur':
        commit(target);
        return false;
    }
    return false;
  }

  var nodeById = (id) => id === 0 ? null : nodes.get(id)?.deref() ?? null;

  native.setListener((type, targetId, data) => {
    var target = nodeById(targetId);
    var kind = EVENT_TYPES[type];
    if (target === null || kind === undefined) return false;
    var [name, EventClass, bubbles, cancelable] = kind;
    var event = new EventClass(name, {
      bubbles,
      cancelable,
      composed: true,
      shiftKey: (data.modifiers & SHIFT) !== 0,
      ctrlKey: (data.modifiers & CONTROL) !== 0,
      altKey: (data.modifiers & ALT) !== 0,
      metaKey: (data.modifiers & META) !== 0,
      clientX: data.x,
      clientY: data.y,
      offsetX: data.offsetX,
      offsetY: data.offsetY,
      button: data.button,
      buttons: data.buttons,
      pointerId: data.pointerId,
      pointerType: data.pointerType,
      pressure: data.pressure,
      isPrimary: true,
      deltaX: data.deltaX,
      deltaY: data.deltaY,
      deltaMode: data.deltaMode,
      key: data.key,
      repeat: data.repeat,
      data: data.data,
      inputType: 'insertText',
      relatedTarget: nodeById(data.related),
      actionName: data.action,
      value: data.value
    });
    (0, _events.trustEvent)(event);
    target.dispatchEvent(event);
    if (event.defaultPrevented) return true;
    return defaultAction(target, event);
  });});
// Generated from native/src/modules/ui/ui.js by scripts/native-modules.mjs. Do not edit.
