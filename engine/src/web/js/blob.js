// Blob and File: immutable bytes with a MIME type. stream() is not provided
// (Soundor has no Web Streams yet).

import { registerCloneable } from 'soundor:internal/web/clone';
import {
  TextDecoder,
  TextEncoder,
  bytesOf,
} from 'soundor:internal/web/encoding';

const encoder = new TextEncoder();

/** The bytes behind a Blob, for fetch bodies and FormData (not public). */
export let blobBytes;

function normalizeType(type) {
  const text = String(type ?? '');
  return /^[\x20-\x7E]*$/.test(text) ? text.toLowerCase() : '';
}

function partBytes(part) {
  if (part instanceof Blob) return blobBytes(part);
  if (part instanceof ArrayBuffer || ArrayBuffer.isView(part))
    return bytesOf(part);
  return encoder.encode(String(part));
}

export class Blob {
  #bytes;
  #type;

  constructor(parts = [], options = {}) {
    if (
      typeof parts !== 'object' ||
      parts === null ||
      typeof parts[Symbol.iterator] !== 'function'
    ) {
      throw new TypeError('Blob parts must be an iterable');
    }
    const chunks = [...parts].map(partBytes);
    const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    this.#bytes = bytes;
    this.#type = normalizeType(options?.type);
  }

  static {
    blobBytes = (blob) => blob.#bytes;
  }

  get size() {
    return this.#bytes.length;
  }
  get type() {
    return this.#type;
  }

  slice(start = 0, end = this.size, contentType = '') {
    const clamp = (index) =>
      index < 0 ? Math.max(this.size + index, 0) : Math.min(index, this.size);
    const from = clamp(Math.trunc(Number(start)) || 0);
    const to = clamp(Math.trunc(Number(end)) || 0);
    return new Blob([this.#bytes.subarray(from, Math.max(from, to))], {
      type: contentType,
    });
  }

  async arrayBuffer() {
    return this.#bytes.slice().buffer;
  }

  async bytes() {
    return this.#bytes.slice();
  }

  async text() {
    return new TextDecoder().decode(this.#bytes);
  }

  get [Symbol.toStringTag]() {
    return 'Blob';
  }
}

export class File extends Blob {
  #name;
  #lastModified;

  constructor(bits, name, options = {}) {
    if (arguments.length < 2)
      throw new TypeError('File requires bits and a name');
    super(bits, options);
    this.#name = String(name);
    this.#lastModified =
      options?.lastModified === undefined
        ? Date.now()
        : Number(options.lastModified);
  }

  get name() {
    return this.#name;
  }
  get lastModified() {
    return this.#lastModified;
  }

  get [Symbol.toStringTag]() {
    return 'File';
  }
}

// File before Blob: clone checks in registration order.
registerCloneable(
  File,
  (file) =>
    new File([file], file.name, {
      type: file.type,
      lastModified: file.lastModified,
    }),
);
registerCloneable(Blob, (blob) => blob.slice(0, blob.size, blob.type));
