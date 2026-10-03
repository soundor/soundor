// Installs Soundor's Web-compatible globals. Soundor is neither a browser nor
// Node: it exposes standard APIs where a standard solves a generic problem, and
// nothing that pretends otherwise (no window, document, process or require).

import { now, timeOrigin } from 'soundor:internal/platform';
import { AbortController, AbortSignal } from 'soundor:internal/web/abort';
import { Blob, File } from 'soundor:internal/web/blob';
import { structuredClone } from 'soundor:internal/web/clone';
import { console, reportError } from 'soundor:internal/web/console';
import { crypto } from 'soundor:internal/web/crypto';
import { TextDecoder, TextEncoder } from 'soundor:internal/web/encoding';
import { CustomEvent, Event, EventTarget } from 'soundor:internal/web/events';
import { Headers, Request, Response, fetch } from 'soundor:internal/web/fetch';
import { FormData } from 'soundor:internal/web/form-data';
import {
  clearInterval,
  clearTimeout,
  queueMicrotask,
  setInterval,
  setTimeout,
} from 'soundor:internal/web/timers';
import { URL, URLSearchParams } from 'soundor:internal/web/url';

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
define('Event', Event);
define('CustomEvent', CustomEvent);
define('EventTarget', EventTarget);
define('AbortController', AbortController);
define('AbortSignal', AbortSignal);
define('TextEncoder', TextEncoder);
define('TextDecoder', TextDecoder);
define('structuredClone', structuredClone);
define('crypto', crypto);
define('URL', URL);
define('URLSearchParams', URLSearchParams);
define('Blob', Blob);
define('File', File);
define('FormData', FormData);
define('Headers', Headers);
define('Request', Request);
define('Response', Response);
define('fetch', fetch);
