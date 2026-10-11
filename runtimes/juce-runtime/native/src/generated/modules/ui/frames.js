(function (exports, require, module) {"use strict";



  var _platform = require("soundor:internal/platform");
  var _ui = require("soundor:internal/ui");
  var _console = require("soundor:internal/web/console"); // requestAnimationFrame / cancelAnimationFrame: callbacks run once, on the
  // plugin view's next frame, before it is drawn, with that frame's time (as
  // performance.now()). Installed with soundor:ui.
  var callbacks = new Map();var nextId = 1;

  function requestAnimationFrame(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('requestAnimationFrame() expects a function');
    }
    var id = nextId++;
    callbacks.set(id, callback);
    return id;
  }

  function cancelAnimationFrame(id) {
    callbacks.delete(id);
  }

  (0, _ui.setFrameListener)(() => {
    if (callbacks.size === 0) return;
    // Callbacks requested during this frame run on the next one.
    var due = callbacks;
    callbacks = new Map();
    var time = (0, _platform.now)();
    for (var callback of due.values()) {
      try {
        callback(time);
      } catch (error) {
        (0, _console.reportError)(error);
      }
    }
  });

  for (var [name, value] of Object.entries({
    requestAnimationFrame,
    cancelAnimationFrame
  })) {
    Object.defineProperty(globalThis, name, {
      value,
      writable: true,
      enumerable: false,
      configurable: true
    });
  }

  // Device pixels per logical pixel, as window.devicePixelRatio: for sizing a
  // canvas's drawing buffer to its box.
  Object.defineProperty(globalThis, 'devicePixelRatio', {
    get: () => (0, _ui.size)().scale,
    enumerable: false,
    configurable: true
  });});
// Generated from native/src/modules/ui/frames.js by scripts/native-modules.mjs. Do not edit.
