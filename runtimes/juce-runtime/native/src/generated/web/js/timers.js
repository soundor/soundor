(function (exports, require, module) {"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.clearTimeout = exports.clearInterval = void 0;exports.queueMicrotask = queueMicrotask;exports.setInterval = setInterval;exports.setTimeout = setTimeout;






  var _platform = require("soundor:internal/platform");
  var _console = require("soundor:internal/web/console"); // setTimeout / setInterval / queueMicrotask over the runtime's event loop.
  //
  // Timers live in JavaScript and die with the context, so a reload never leaves
  // one behind. The native side is told only when the earliest timer is due and
  // calls back when that time has passed (it runs on the plugin view's frame
  // tick, so delays have frame resolution).
  var MAX_DELAY = 2 ** 31 - 1;var timers = new Map();var nextId = 1;function schedule() {
    var earliest = Infinity;
    for (var timer of timers.values())
    if (timer.due < earliest) earliest = timer.due;
    (0, _platform.setWake)(earliest);
  }

  function start(callback, delay, args, repeat) {
    if (typeof callback !== 'function') {
      // Browsers would eval a string; Soundor has no implied eval.
      throw new TypeError('The timer callback must be a function');
    }
    var ms = Number(delay);
    if (!(ms >= 0)) ms = 0;
    if (ms > MAX_DELAY) ms = MAX_DELAY;
    var id = nextId++;
    timers.set(id, {
      callback,
      args,
      due: (0, _platform.now)() + ms,
      interval: repeat ? ms : -1
    });
    schedule();
    return id;
  }

  function stop(id) {
    if (timers.delete(id)) schedule();
  }

  function setTimeout(callback, delay = 0, ...args) {
    return start(callback, delay, args, false);
  }

  function setInterval(callback, delay = 0, ...args) {
    return start(callback, delay, args, true);
  }

  var clearTimeout = exports.clearTimeout = stop;
  var clearInterval = exports.clearInterval = stop;

  function queueMicrotask(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('queueMicrotask() expects a function');
    }
    Promise.resolve().then(() => {
      try {
        callback();
      } catch (error) {
        (0, _console.reportError)(error);
      }
    });
  }

  (0, _platform.setTimerDispatcher)((time) => {
    // Only timers already due run now; ones they start wait for a later tick.
    var due = [...timers].filter(([, timer]) => timer.due <= time);
    due.sort(([a, x], [b, y]) => x.due - y.due || a - b);
    for (var [id, timer] of due) {
      if (timers.get(id) !== timer) continue; // cleared by an earlier callback
      if (timer.interval >= 0) timer.due = time + Math.max(timer.interval, 1);else
      timers.delete(id);
      try {
        timer.callback(...timer.args);
      } catch (error) {
        (0, _console.reportError)(error);
      }
    }
    schedule();
  });});
// Generated from native/src/web/js/timers.js by scripts/native-modules.mjs. Do not edit.
