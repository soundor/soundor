// Installs Soundor's Web-compatible globals. Soundor is neither a browser nor
// Node: it exposes standard APIs where a standard solves a generic problem, and
// nothing that pretends otherwise (no window, document, process or require).

import { now, timeOrigin } from 'soundor:internal/platform';
import { console, reportError } from 'soundor:internal/web/console';
import {
  clearInterval,
  clearTimeout,
  queueMicrotask,
  setInterval,
  setTimeout,
} from 'soundor:internal/web/timers';

function define(name, value) {
  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

const performance = Object.freeze({
  now,
  timeOrigin,
  toJSON: () => ({ timeOrigin }),
});

define('self', globalThis);
define('console', console);
define('reportError', reportError);
define('performance', performance);
define('setTimeout', setTimeout);
define('clearTimeout', clearTimeout);
define('setInterval', setInterval);
define('clearInterval', clearInterval);
define('queueMicrotask', queueMicrotask);
