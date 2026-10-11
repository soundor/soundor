(function (exports, require, module) {"use strict";



  var _platform = require("soundor:internal/platform");
  var _abort = require("soundor:internal/web/abort");
  var _base = require("soundor:internal/web/base64");
  var _blob = require("soundor:internal/web/blob");
  var _clone = require("soundor:internal/web/clone");
  var _console = require("soundor:internal/web/console");
  var _crypto = require("soundor:internal/web/crypto");
  var _domException = require("soundor:internal/web/dom-exception");
  var _encoding = require("soundor:internal/web/encoding");
  var _events = require("soundor:internal/web/events");
  var _fetch = require("soundor:internal/web/fetch");
  var _formData = require("soundor:internal/web/form-data");
  var _timers = require("soundor:internal/web/timers");






  var _url = require("soundor:internal/web/url"); // Installs Soundor's Web-compatible globals. Soundor is neither a browser nor
  // Node: it exposes standard APIs where a standard solves a generic problem, and
  // nothing that pretends otherwise (no window, document, process or require).
  function define(name, value) {Object.defineProperty(globalThis, name, {
      value,
      writable: true,
      enumerable: false,
      configurable: true
    });
  }

  var performance = Object.freeze({
    now: _platform.now,
    timeOrigin: _platform.timeOrigin,
    toJSON: () => ({ timeOrigin: _platform.timeOrigin })
  });

  define('self', globalThis);
  define('DOMException', _domException.DOMException);
  define('atob', _base.atob);
  define('btoa', _base.btoa);
  define('console', _console.console);
  define('reportError', _console.reportError);
  define('performance', performance);
  define('setTimeout', _timers.setTimeout);
  define('clearTimeout', _timers.clearTimeout);
  define('setInterval', _timers.setInterval);
  define('clearInterval', _timers.clearInterval);
  define('queueMicrotask', _timers.queueMicrotask);
  define('Event', _events.Event);
  define('CustomEvent', _events.CustomEvent);
  define('EventTarget', _events.EventTarget);
  define('AbortController', _abort.AbortController);
  define('AbortSignal', _abort.AbortSignal);
  define('TextEncoder', _encoding.TextEncoder);
  define('TextDecoder', _encoding.TextDecoder);
  define('structuredClone', _clone.structuredClone);
  define('crypto', _crypto.crypto);
  define('URL', _url.URL);
  define('URLSearchParams', _url.URLSearchParams);
  define('Blob', _blob.Blob);
  define('File', _blob.File);
  define('FormData', _formData.FormData);
  define('Headers', _fetch.Headers);
  define('Request', _fetch.Request);
  define('Response', _fetch.Response);
  define('fetch', _fetch.fetch);});
// Generated from native/src/web/js/web.js by scripts/native-modules.mjs. Do not edit.
