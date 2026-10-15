// requestAnimationFrame / cancelAnimationFrame: callbacks run once, on the
// plugin view's next frame, before it is drawn, with that frame's time (as
// performance.now()). Installed with soundor:ui.

import { now } from 'soundor:internal/platform';
import { setFrameListener, size } from 'soundor:internal/ui';
import { reportError } from 'soundor:internal/web/console';

let callbacks = new Map();
let nextId = 1;

function requestAnimationFrame(callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('requestAnimationFrame() expects a function');
  }
  const id = nextId++;
  callbacks.set(id, callback);
  return id;
}

function cancelAnimationFrame(id) {
  callbacks.delete(id);
}

setFrameListener(() => {
  if (callbacks.size === 0) return;
  // Callbacks requested during this frame run on the next one.
  const due = callbacks;
  callbacks = new Map();
  const time = now();
  for (const callback of due.values()) {
    try {
      callback(time);
    } catch (error) {
      reportError(error);
    }
  }
});

for (const [name, value] of Object.entries({
  requestAnimationFrame,
  cancelAnimationFrame,
})) {
  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

// Device pixels per logical pixel, as window.devicePixelRatio: for sizing a
// canvas's drawing buffer to its box.
Object.defineProperty(globalThis, 'devicePixelRatio', {
  get: () => size().scale,
  enumerable: false,
  configurable: true,
});
