(function (exports, require, module) {"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.console = void 0;exports.formatArgs = formatArgs;exports.reportError = reportError;


  var _platform = require("soundor:internal/platform");
  var _inspect = require("soundor:internal/web/inspect"); // `console`: formats its arguments and writes them to the runtime's log sink
  // (the `soundor dev` terminal in development).
  var DEBUG = 0;
  var INFO = 1;
  var WARN = 2;
  var ERROR = 3;

  var indent = '';
  var counts = new Map();
  var timers = new Map();

  /** printf-style formatting of a first string argument, then inspect(). */
  function formatArgs(args) {
    var parts = [];
    var index = 0;
    if (typeof args[0] === 'string' && args.length > 1) {
      index = 1;
      parts.push(
        args[0].replace(/%([sdifjoOc%])/g, (match, directive) => {
          if (directive === '%') return '%';
          if (index >= args.length) return match;
          var arg = args[index++];
          switch (directive) {
            case 's':
              return typeof arg === 'string' ? arg : (0, _inspect.inspect)(arg, { depth: 0 });
            case 'd':
            case 'i':{
                var number = typeof arg === 'bigint' ? arg : Number(arg);
                return typeof number === 'bigint' ?
                `${number}n` :
                String(directive === 'i' ? Math.trunc(number) : number);
              }
            case 'f':
              return String(Number(arg));
            case 'j':
              try {
                return JSON.stringify(arg);
              } catch {
                return '[Circular]';
              }
            case 'o':
            case 'O':
              return (0, _inspect.inspect)(arg, { depth: directive === 'o' ? 4 : 2 });
            case 'c':
              return ''; // CSS has no meaning in a terminal
          }
          return match;
        })
      );
    }
    for (; index < args.length; index++) {
      parts.push(
        typeof args[index] === 'string' ? args[index] : (0, _inspect.inspect)(args[index])
      );
    }
    return parts.join(' ');
  }

  function emit(level, args) {
    var text = formatArgs(args);
    (0, _platform.write)(level, indent === '' ? text : text.replace(/^/gm, indent));
  }

  function label(value) {
    return value === undefined ? 'default' : String(value);
  }

  var console = exports.console = {
    log: (...args) => emit(INFO, args),
    info: (...args) => emit(INFO, args),
    debug: (...args) => emit(DEBUG, args),
    warn: (...args) => emit(WARN, args),
    error: (...args) => emit(ERROR, args),
    trace: (...args) => {
      var stack = new Error().stack?.split('\n').slice(1).join('\n') ?? '';
      emit(INFO, [`Trace: ${formatArgs(args)}\n${stack}`.trimEnd()]);
    },
    assert: (condition, ...args) => {
      if (!condition) {
        emit(
          ERROR,
          args.length > 0 ? ['Assertion failed:', ...args] : ['Assertion failed']
        );
      }
    },
    dir: (value) => emit(INFO, [(0, _inspect.inspect)(value)]),
    table: (...args) => emit(INFO, args),
    group: (...args) => {
      if (args.length > 0) emit(INFO, args);
      indent += '  ';
    },
    groupCollapsed: (...args) => console.group(...args),
    groupEnd: () => {
      indent = indent.slice(2);
    },
    count: (name) => {
      var key = label(name);
      var count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      emit(INFO, [`${key}: ${count}`]);
    },
    countReset: (name) => {
      counts.delete(label(name));
    },
    time: (name) => {
      timers.set(label(name), performance.now());
    },
    timeLog: (name, ...args) => {
      var key = label(name);
      var start = timers.get(key);
      if (start === undefined) emit(WARN, [`Timer '${key}' does not exist`]);else

      emit(INFO, [
      `${key}: ${(performance.now() - start).toFixed(3)} ms`,
      ...args]
      );
    },
    timeEnd: (name) => {
      console.timeLog(name);
      timers.delete(label(name));
    }
  };

  /** Reports an exception nobody caught (Web reportError()). */
  function reportError(error) {
    emit(ERROR, ['Uncaught', error]);
  }});
// Generated from native/src/web/js/console.js by scripts/native-modules.mjs. Do not edit.
