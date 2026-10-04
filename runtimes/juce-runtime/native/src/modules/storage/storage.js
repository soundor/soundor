// soundor:storage — small, persistent, plugin-scoped key/value storage. Values
// are anything JSON can represent; every operation is asynchronous and lands
// on disk before its promise resolves.

import { storageOperation } from 'soundor:internal/platform';

function key(value) {
  if (typeof value !== 'string')
    throw new TypeError('Storage keys must be strings');
  return value;
}

export const storage = Object.freeze({
  /** The stored value, or undefined. */
  async get(name) {
    const text = await storageOperation('get', key(name), '');
    return text === undefined ? undefined : JSON.parse(text);
  },

  /** Stores a JSON-serializable value. */
  async set(name, value) {
    const text = JSON.stringify(value);
    if (text === undefined) {
      throw new TypeError(
        `soundor:storage cannot store ${typeof value} values; store JSON data`,
      );
    }
    await storageOperation('set', key(name), text);
  },

  async delete(name) {
    await storageOperation('delete', key(name), '');
  },

  /** Every stored key, sorted. */
  keys() {
    return storageOperation('keys', '', '');
  },

  async clear() {
    await storageOperation('clear', '', '');
  },
});
