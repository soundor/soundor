(function (exports, require, module) {"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.eventParent = exports.EventTarget = exports.Event = exports.CustomEvent = void 0;exports.trustEvent = trustEvent;




  var _platform = require("soundor:internal/platform");
  var _console = require("soundor:internal/web/console");function _inherits(t, e) {if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function");t.prototype = Object.create(e && e.prototype, { constructor: { value: t, writable: !0, configurable: !0 } }), Object.defineProperty(t, "prototype", { writable: !1 }), e && _setPrototypeOf(t, e);}function _setPrototypeOf(t, e) {return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (t, e) {return t.__proto__ = e, t;}, _setPrototypeOf(t, e);}function _callSuper(t, o, e) {return o = _getPrototypeOf(o), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e));}function _possibleConstructorReturn(t, e) {if (e && ("object" == typeof e || "function" == typeof e)) return e;if (void 0 !== e) throw new TypeError("Derived constructors may only return object or undefined");return _assertThisInitialized(t);}function _assertThisInitialized(e) {if (void 0 === e) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e;}function _isNativeReflectConstruct() {try {var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {}));} catch (t) {}return (_isNativeReflectConstruct = function () {return !!t;})();}function _getPrototypeOf(t) {return _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function (t) {return t.__proto__ || Object.getPrototypeOf(t);}, _getPrototypeOf(t);}function _classCallCheck(a, n) {if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");}function _defineProperties(e, r) {for (var t = 0; t < r.length; t++) {var o = r[t];o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o);}}function _createClass(e, r, t) {return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e;}function _toPropertyKey(t) {var i = _toPrimitive(t, "string");return "symbol" == typeof i ? i : i + "";}function _toPrimitive(t, e) {if ("object" != typeof t || !t) return t;var r;if ("undefined" != typeof Symbol && void 0 !== (r = t[Symbol.toPrimitive])) {var i = r.call(t, e || "default");if ("object" != typeof i) return i;throw new TypeError("@@toPrimitive must return a primitive value.");}return ("string" === e ? String : Number)(t);}function _classPrivateFieldLooseBase(e, t) {if (!{}.hasOwnProperty.call(e, t)) throw new TypeError("attempted to use private field on non-instance");return e;} // Event, CustomEvent and EventTarget: the DOM event model without the DOM.
  // A plain EventTarget has no parent, so an event reaches its target only.
  // Targets that form a tree (soundor:ui nodes) define `[eventParent]()`, and
  // events then run the DOM's capture, target and bubble phases along it.
  var NONE = 0;var CAPTURING_PHASE = 1;var AT_TARGET = 2;
  var BUBBLING_PHASE = 3;

  /** The method by which a target names its parent in an event path. */
  var eventParent = exports.eventParent = Symbol('eventParent');

  /** Lets EventTarget drive an event's dispatch state without making it public. */
  var dispatchState;var _type = Symbol("type");var _bubbles = Symbol("bubbles");var _cancelable = Symbol("cancelable");var _composed = Symbol("composed");var _defaultPrevented = Symbol("defaultPrevented");var _target = Symbol("target");var _currentTarget = Symbol("currentTarget");var _phase = Symbol("phase");var _timeStamp = Symbol("timeStamp");var _stopped = Symbol("stopped");var _stoppedImmediately = Symbol("stoppedImmediately");var _inPassiveListener = Symbol("inPassiveListener");var _trusted = Symbol("trusted");var _path = Symbol("path");var

  Event = exports.Event = /*#__PURE__*/function () {















    function Event(type, init = {}) {_classCallCheck(this, Event);Object.defineProperty(this, _type, { writable: true, value: void 0 });Object.defineProperty(this, _bubbles, { writable: true, value: void 0 });Object.defineProperty(this, _cancelable, { writable: true, value: void 0 });Object.defineProperty(this, _composed, { writable: true, value: void 0 });Object.defineProperty(this, _defaultPrevented, { writable: true, value: false });Object.defineProperty(this, _target, { writable: true, value: null });Object.defineProperty(this, _currentTarget, { writable: true, value: null });Object.defineProperty(this, _phase, { writable: true, value: NONE });Object.defineProperty(this, _timeStamp, { writable: true, value: (0, _platform.now)() });Object.defineProperty(this, _stopped, { writable: true, value: false });Object.defineProperty(this, _stoppedImmediately, { writable: true, value: false });Object.defineProperty(this, _inPassiveListener, { writable: true, value: false });Object.defineProperty(this, _trusted, { writable: true, value: false });Object.defineProperty(this, _path, { writable: true, value: [] });
      if (arguments.length === 0) {
        throw new TypeError("Event constructor requires a 'type' argument");
      }
      this[_type] = String(type);
      this[_bubbles] = Boolean(init?.bubbles);
      this[_cancelable] = Boolean(init?.cancelable);
      this[_composed] = Boolean(init?.composed);
    }return _createClass(Event, [{ key: "type", get:

      function () {
        return this[_type];
      } }, { key: "bubbles", get:
      function () {
        return this[_bubbles];
      } }, { key: "cancelable", get:
      function () {
        return this[_cancelable];
      } }, { key: "composed", get:
      function () {
        return this[_composed];
      } }, { key: "defaultPrevented", get:
      function () {
        return this[_defaultPrevented];
      } }, { key: "target", get:
      function () {
        return this[_target];
      } }, { key: "srcElement", get:
      function () {
        return this[_target];
      } }, { key: "currentTarget", get:
      function () {
        return this[_currentTarget];
      } }, { key: "eventPhase", get:
      function () {
        return this[_phase];
      } }, { key: "timeStamp", get:
      function () {
        return this[_timeStamp];
      } }, { key: "isTrusted", get:
      function () {
        return this[_trusted];
      } }, { key: "returnValue", get:
      function () {
        return !this[_defaultPrevented];
      } }, { key: "composedPath", value:

      function composedPath() {
        return this[_phase] === NONE ? [] : [...this[_path]];
      } }, { key: "preventDefault", value:

      function preventDefault() {
        if (this[_cancelable] && !this[_inPassiveListener])
        this[_defaultPrevented] = true;
      } }, { key: "stopPropagation", value:

      function stopPropagation() {
        this[_stopped] = true;
      } }, { key: "stopImmediatePropagation", value:

      function stopImmediatePropagation() {
        this[_stopped] = true;
        this[_stoppedImmediately] = true;
      } }]);}();




































  /** Marks an event as coming from the user (native input), not from script. */dispatchState = { begin(event, target, path) {if (event[_phase] !== NONE) {throw new DOMException('The event is already being dispatched', 'InvalidStateError');}event[_target] = target;event[_path] = path;event[_stopped] = false;event[_stoppedImmediately] = false;}, at(event, currentTarget, phase) {event[_currentTarget] = currentTarget;event[_phase] = phase;}, end(event) {event[_currentTarget] = null;event[_phase] = NONE;event[_path] = [];}, stopped: (event) => event[_stopped], stoppedImmediately: (event) => event[_stoppedImmediately], setPassive(event, passive) {event[_inPassiveListener] = passive;}, trust(event) {event[_trusted] = true;} };
  function trustEvent(event) {
    dispatchState.trust(event);
    return event;
  }

  Event.NONE = NONE;
  Event.CAPTURING_PHASE = CAPTURING_PHASE;
  Event.AT_TARGET = AT_TARGET;
  Event.BUBBLING_PHASE = BUBBLING_PHASE;var _detail = Symbol("detail");var

  CustomEvent = exports.CustomEvent = /*#__PURE__*/function (_Event2) {


    function CustomEvent(type, init = {}) {var _this;_classCallCheck(this, CustomEvent);
      _this = _callSuper(this, CustomEvent, [type, init]);Object.defineProperty(_this, _detail, { writable: true, value: void 0 });
      _this[_detail] = init?.detail ?? null;return _this;
    }_inherits(CustomEvent, _Event2);return _createClass(CustomEvent, [{ key: "detail", get:

      function () {
        return this[_detail];
      } }]);}(Event);


  function normalizeOptions(options) {
    if (typeof options === 'boolean') return { capture: options };
    return options ?? {};
  }var _listeners = Symbol("listeners");var _invoke = Symbol("invoke");var

  EventTarget = exports.EventTarget = /*#__PURE__*/function () {function EventTarget() {_classCallCheck(this, EventTarget);Object.defineProperty(this, _invoke, { value: _invoke2 });Object.defineProperty(this, _listeners, { writable: true, value:
        new Map() });}return _createClass(EventTarget, [{ key: "addEventListener", value:

      function addEventListener(type, listener, options) {
        if (listener === null || listener === undefined) return;
        if (
        typeof listener !== 'function' &&
        typeof listener?.handleEvent !== 'function')
        {
          throw new TypeError(
            'addEventListener() expects a function or an object with handleEvent()'
          );
        }
        var {
          capture = false,
          once = false,
          passive = false,
          signal
        } = normalizeOptions(options);
        if (signal?.aborted) return;
        var key = String(type);
        var list = this[_listeners].get(key);
        if (list === undefined) {
          list = [];
          this[_listeners].set(key, list);
        }
        if (
        list.some(
          (entry) =>
          entry.listener === listener && entry.capture === Boolean(capture)
        ))

        return;
        var entry = {
          listener,
          capture: Boolean(capture),
          once,
          passive,
          removed: false
        };
        list.push(entry);
        signal?.addEventListener(
          'abort',
          () => this.removeEventListener(key, listener, { capture }),
          {
            once: true
          }
        );
      } }, { key: "removeEventListener", value:

      function removeEventListener(type, listener, options) {
        var { capture = false } = normalizeOptions(options);
        var list = this[_listeners].get(String(type));
        if (list === undefined) return;
        var index = list.findIndex(
          (entry) =>
          entry.listener === listener && entry.capture === Boolean(capture)
        );
        if (index < 0) return;
        list[index].removed = true;
        list.splice(index, 1);
      } }, { key: "dispatchEvent", value:

      function dispatchEvent(event) {
        if (!(event instanceof Event)) {
          throw new TypeError('dispatchEvent() expects an Event');
        }
        var path = [this];
        for (var node = this[eventParent]?.(); node; node = node[eventParent]?.())
        path.push(node);
        dispatchState.begin(event, this, path);
        try {
          for (var i = path.length - 1; i > 0; --i) {
            if (dispatchState.stopped(event)) break;
            path[i][_invoke](event, CAPTURING_PHASE, true);
          }
          // At the target, capturing listeners run before the others.
          if (!dispatchState.stopped(event)) this[_invoke](event, AT_TARGET, true);
          if (!dispatchState.stopped(event)) this[_invoke](event, AT_TARGET, false);
          if (event.bubbles) {
            for (var _i = 1; _i < path.length; ++_i) {
              if (dispatchState.stopped(event)) break;
              path[_i][_invoke](event, BUBBLING_PHASE, false);
            }
          }
        } finally {
          dispatchState.end(event);
        }
        return !event.defaultPrevented;
      } }]);}();function _invoke2(

  event, phase, capture) {
    var list = this[_listeners].get(event.type);
    if (list === undefined) return;
    dispatchState.at(event, this, phase);
    for (var entry of [...list]) {
      if (entry.removed || entry.capture !== capture) continue;
      if (entry.once)
      this.removeEventListener(event.type, entry.listener, entry);
      dispatchState.setPassive(event, entry.passive);
      try {
        if (typeof entry.listener === 'function')
        entry.listener.call(this, event);else
        entry.listener.handleEvent(event);
      } catch (error) {
        (0, _console.reportError)(error);
      }
      dispatchState.setPassive(event, false);
      if (dispatchState.stoppedImmediately(event)) break;
    }
  }});
// Generated from native/src/web/js/events.js by scripts/native-modules.mjs. Do not edit.
