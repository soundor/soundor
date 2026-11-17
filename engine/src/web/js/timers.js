// setTimeout / setInterval / queueMicrotask over the runtime's event loop.
//
// Timers live in JavaScript and die with the context, so a reload never leaves
// one behind. The native side is told only when the earliest timer is due and
// calls back when that time has passed (it runs on the plugin view's frame
// tick, so delays have frame resolution).

import { now, setTimerDispatcher, setWake } from 'soundor:internal/platform';
import { reportError } from 'soundor:internal/web/console';

const MAX_DELAY = 2 ** 31 - 1;
const timers = new Map();
let nextId = 1;

function schedule() {
  let earliest = Infinity;
  for (const timer of timers.values())
    if (timer.due < earliest) earliest = timer.due;
  setWake(earliest);
}

function start(callback, delay, args, repeat) {
  if (typeof callback !== 'function') {
    // Browsers would eval a string; Soundor has no implied eval.
    throw new TypeError('The timer callback must be a function');
  }
  let ms = Number(delay);
  if (!(ms >= 0)) ms = 0;
  if (ms > MAX_DELAY) ms = MAX_DELAY;
  const id = nextId++;
  timers.set(id, {
    callback,
    args,
    due: now() + ms,
    interval: repeat ? ms : -1,
  });
  schedule();
  return id;
}

function stop(id) {
  if (timers.delete(id)) schedule();
}

export function setTimeout(callback, delay = 0, ...args) {
  return start(callback, delay, args, false);
}

export function setInterval(callback, delay = 0, ...args) {
  return start(callback, delay, args, true);
}

export const clearTimeout = stop;
export const clearInterval = stop;

export function queueMicrotask(callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('queueMicrotask() expects a function');
  }
  Promise.resolve().then(() => {
    try {
      callback();
    } catch (error) {
      reportError(error);
    }
  });
}

setTimerDispatcher((time) => {
  // Only timers already due run now; ones they start wait for a later tick.
  const due = [...timers].filter(([, timer]) => timer.due <= time);
  due.sort(([a, x], [b, y]) => x.due - y.due || a - b);
  for (const [id, timer] of due) {
    if (timers.get(id) !== timer) continue; // cleared by an earlier callback
    if (timer.interval >= 0) timer.due = time + Math.max(timer.interval, 1);
    else timers.delete(id);
    try {
      timer.callback(...timer.args);
    } catch (error) {
      reportError(error);
    }
  }
  schedule();
});
