// TextEncoder and TextDecoder (UTF-8, as the Encoding Standard requires of
// TextEncoder; TextDecoder supports the UTF-8 labels).

import {
  decodeUtf8,
  encodeUtf8,
  encodeUtf8Into,
} from 'soundor:internal/platform';

const UTF8_LABELS = new Set([
  'unicode-1-1-utf-8',
  'unicode11utf8',
  'unicode20utf8',
  'utf-8',
  'utf8',
  'x-unicode20utf8',
]);

export class TextEncoder {
  get encoding() {
    return 'utf-8';
  }

  encode(input = '') {
    return encodeUtf8(String(input));
  }

  encodeInto(source, destination) {
    if (!(destination instanceof Uint8Array)) {
      throw new TypeError('encodeInto() expects a Uint8Array destination');
    }
    const [read, written] = encodeUtf8Into(String(source), destination);
    return { read, written };
  }
}

/** A Uint8Array over any BufferSource, without copying. */
export function bytesOf(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new TypeError('Expected an ArrayBuffer or an ArrayBuffer view');
}

export class TextDecoder {
  #fatal;
  #ignoreBOM;
  #pending = new Uint8Array(0);
  #bomSeen = false;

  constructor(label = 'utf-8', options = {}) {
    const normalized = String(label).trim().toLowerCase();
    if (!UTF8_LABELS.has(normalized)) {
      throw new RangeError(
        `The encoding label '${label}' is not supported; Soundor decodes UTF-8 only`,
      );
    }
    this.#fatal = Boolean(options?.fatal);
    this.#ignoreBOM = Boolean(options?.ignoreBOM);
  }

  get encoding() {
    return 'utf-8';
  }
  get fatal() {
    return this.#fatal;
  }
  get ignoreBOM() {
    return this.#ignoreBOM;
  }

  decode(input, options = {}) {
    const stream = Boolean(options?.stream);
    let bytes = input === undefined ? new Uint8Array(0) : bytesOf(input);
    if (this.#pending.length > 0) {
      const joined = new Uint8Array(this.#pending.length + bytes.length);
      joined.set(this.#pending);
      joined.set(bytes, this.#pending.length);
      bytes = joined;
    }
    let text;
    let consumed;
    try {
      [text, consumed] = decodeUtf8(bytes, this.#fatal, !stream);
    } catch (error) {
      this.#reset();
      throw error;
    }
    this.#pending = bytes.slice(consumed);
    if (!this.#ignoreBOM && !this.#bomSeen && text.length > 0) {
      this.#bomSeen = true;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    if (!stream) this.#reset();
    return text;
  }

  #reset() {
    this.#pending = new Uint8Array(0);
    this.#bomSeen = false;
  }
}
