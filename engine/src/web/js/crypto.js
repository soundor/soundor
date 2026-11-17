// crypto.getRandomValues() and crypto.randomUUID() from the operating system's
// CSPRNG. crypto.subtle (WebCrypto) is not provided.

import { fillRandom } from 'soundor:internal/platform';

const INTEGER_ARRAYS = [
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  BigInt64Array,
  BigUint64Array,
];

const MAX_BYTES = 65536;

function getRandomValues(array) {
  if (!INTEGER_ARRAYS.some((type) => array instanceof type)) {
    throw new DOMException(
      'getRandomValues() expects an integer typed array',
      'TypeMismatchError',
    );
  }
  if (array.byteLength > MAX_BYTES) {
    throw new DOMException(
      `getRandomValues() can fill at most ${MAX_BYTES} bytes at a time`,
      'QuotaExceededError',
    );
  }
  fillRandom(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  return array;
}

const HEX = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0'),
);

function randomUUID() {
  const bytes = new Uint8Array(16);
  fillRandom(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 9562 variant
  const hex = Array.from(bytes, (byte) => HEX[byte]);
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

export const crypto = Object.freeze({ getRandomValues, randomUUID });
