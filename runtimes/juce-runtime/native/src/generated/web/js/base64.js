(function (exports, require, module) {"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.atob = atob;exports.btoa = btoa; // atob() and btoa() (HTML): base64 over "binary strings", whose characters are
  // bytes (U+0000 to U+00FF).

  var ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var VALUES = new Map(
    [...ALPHABET].map((character, index) => [character, index])
  );

  function btoa(data) {
    if (arguments.length === 0) {
      throw new TypeError("btoa() requires a 'data' argument");
    }
    var text = String(data);
    var output = '';
    for (var i = 0; i < text.length; i += 3) {
      var bytes = [
      text.charCodeAt(i),
      text.charCodeAt(i + 1),
      text.charCodeAt(i + 2)];

      for (var k = 0; k < 3 && i + k < text.length; k++) {
        if (bytes[k] > 0xff) {
          throw new DOMException(
            "Failed to execute 'btoa': the string contains characters outside of the Latin1 range.",
            'InvalidCharacterError'
          );
        }
      }
      var length = Math.min(3, text.length - i);
      var triple =
      bytes[0] << 16 |
      (length > 1 ? bytes[1] : 0) << 8 | (
      length > 2 ? bytes[2] : 0);
      output += ALPHABET[triple >> 18 & 63] + ALPHABET[triple >> 12 & 63];
      output += length > 1 ? ALPHABET[triple >> 6 & 63] : '=';
      output += length > 2 ? ALPHABET[triple & 63] : '=';
    }
    return output;
  }

  function atob(data) {
    if (arguments.length === 0) {
      throw new TypeError("atob() requires a 'data' argument");
    }
    // The forgiving-base64 decode: ASCII whitespace ignored, padding optional.
    var text = String(data).replace(/[\t\n\f\r ]/g, '');
    if (text.length % 4 === 0) text = text.replace(/==?$/, '');
    var invalid = () =>
    new DOMException(
      "Failed to execute 'atob': the string to be decoded is not correctly encoded.",
      'InvalidCharacterError'
    );
    if (text.length % 4 === 1) throw invalid();
    var output = '';
    var buffer = 0;
    var bits = 0;
    for (var character of text) {
      var value = VALUES.get(character);
      if (value === undefined) throw invalid();
      buffer = buffer << 6 | value;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        output += String.fromCharCode(buffer >> bits & 0xff);
      }
    }
    return output;
  }});
// Generated from native/src/web/js/base64.js by scripts/native-modules.mjs. Do not edit.
