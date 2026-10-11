// atob() and btoa() (HTML): base64 over "binary strings", whose characters are
// bytes (U+0000 to U+00FF).

const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VALUES = new Map(
  [...ALPHABET].map((character, index) => [character, index]),
);

export function btoa(data) {
  if (arguments.length === 0) {
    throw new TypeError("btoa() requires a 'data' argument");
  }
  const text = String(data);
  let output = '';
  for (let i = 0; i < text.length; i += 3) {
    const bytes = [
      text.charCodeAt(i),
      text.charCodeAt(i + 1),
      text.charCodeAt(i + 2),
    ];
    for (let k = 0; k < 3 && i + k < text.length; k++) {
      if (bytes[k] > 0xff) {
        throw new DOMException(
          "Failed to execute 'btoa': the string contains characters outside of the Latin1 range.",
          'InvalidCharacterError',
        );
      }
    }
    const length = Math.min(3, text.length - i);
    const triple =
      (bytes[0] << 16) |
      ((length > 1 ? bytes[1] : 0) << 8) |
      (length > 2 ? bytes[2] : 0);
    output += ALPHABET[(triple >> 18) & 63] + ALPHABET[(triple >> 12) & 63];
    output += length > 1 ? ALPHABET[(triple >> 6) & 63] : '=';
    output += length > 2 ? ALPHABET[triple & 63] : '=';
  }
  return output;
}

export function atob(data) {
  if (arguments.length === 0) {
    throw new TypeError("atob() requires a 'data' argument");
  }
  // The forgiving-base64 decode: ASCII whitespace ignored, padding optional.
  let text = String(data).replace(/[\t\n\f\r ]/g, '');
  if (text.length % 4 === 0) text = text.replace(/==?$/, '');
  const invalid = () =>
    new DOMException(
      "Failed to execute 'atob': the string to be decoded is not correctly encoded.",
      'InvalidCharacterError',
    );
  if (text.length % 4 === 1) throw invalid();
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (const character of text) {
    const value = VALUES.get(character);
    if (value === undefined) throw invalid();
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return output;
}
