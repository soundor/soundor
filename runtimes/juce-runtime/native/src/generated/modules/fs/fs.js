(function (exports, require, module) {"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.exists = exists;exports.mkdir = mkdir;exports.readBytes = readBytes;exports.readDir = readDir;exports.readText = readText;exports.remove = remove;exports.stat = stat;exports.writeBytes = writeBytes;exports.writeText = writeText;



  var _platform = require("soundor:internal/platform");function asyncGeneratorStep(n, t, e, r, o, a, c) {try {var i = n[a](c),u = i.value;} catch (n) {return void e(n);}i.done ? t(u) : Promise.resolve(u).then(r, o);}function _asyncToGenerator(n) {return function () {var t = this,e = arguments;return new Promise(function (r, o) {var a = n.apply(t, e);function _next(n) {asyncGeneratorStep(a, r, o, _next, _throw, "next", n);}function _throw(n) {asyncGeneratorStep(a, r, o, _next, _throw, "throw", n);}_next(void 0);});};} // soundor:fs — asynchronous file access confined to the plugin's private data
  // directory. Paths are relative ('presets/warm.json'); there is no way to name
  // a file outside that directory.
  var encoder = new TextEncoder();var decoder = new TextDecoder();

  function path(value) {
    if (typeof value !== 'string')
    throw new TypeError('soundor:fs paths must be strings');
    return value;
  }

  /** The file's bytes. */
  function readBytes(file) {
    return (0, _platform.fsOperation)('readBytes', path(file), null, false);
  }

  /** The file's contents, decoded as UTF-8. */function
  readText(_x) {return _readText.apply(this, arguments);}



  /** Replaces the file atomically, creating missing parent directories. */function _readText() {_readText = _asyncToGenerator(function* (file) {return decoder.decode(yield readBytes(file));});return _readText.apply(this, arguments);}
  function writeBytes(file, data) {
    if (!(data instanceof ArrayBuffer || ArrayBuffer.isView(data))) {
      throw new TypeError('writeBytes() expects an ArrayBuffer or a typed array');
    }
    var bytes =
    data instanceof ArrayBuffer ?
    new Uint8Array(data) :
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return (0, _platform.fsOperation)('writeBytes', path(file), bytes, false);
  }

  /** Writes `text` as UTF-8, atomically. */
  function writeText(file, text) {
    return (0, _platform.fsOperation)(
      'writeBytes',
      path(file),
      encoder.encode(String(text)),
      false
    );
  }

  /** The directory's entries ({ name, kind }), sorted by name. */
  function readDir(directory = '.') {
    return (0, _platform.fsOperation)('readDir', path(directory), null, false);
  }

  function mkdir(directory, options = {}) {
    return (0, _platform.fsOperation)(
      'mkdir',
      path(directory),
      null,
      Boolean(options.recursive)
    );
  }

  /** Removes a file, or a directory (which must be empty unless `recursive`). */
  function remove(target, options = {}) {
    return (0, _platform.fsOperation)('remove', path(target), null, Boolean(options.recursive));
  }

  /** { kind, size, modified } of an entry, or null if it does not exist. */
  function stat(target) {
    return (0, _platform.fsOperation)('stat', path(target), null, false);
  }function

  exists(_x2) {return _exists.apply(this, arguments);}function _exists() {_exists = _asyncToGenerator(function* (target) {
      return (yield stat(target)) !== null;
    });return _exists.apply(this, arguments);}});
// Generated from native/src/modules/fs/fs.js by scripts/native-modules.mjs. Do not edit.
