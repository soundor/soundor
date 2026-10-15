// FormData: ordered name/value entries, values being strings or Files.

import { Blob, File } from 'soundor:internal/web/blob';

function entryValue(value, filename) {
  if (value instanceof Blob) {
    if (filename !== undefined) {
      return new File([value], String(filename), { type: value.type });
    }
    return value instanceof File
      ? value
      : new File([value], 'blob', { type: value.type });
  }
  return String(value).toWellFormed();
}

export class FormData {
  #entries = [];

  constructor(form = undefined) {
    if (form !== undefined) {
      throw new TypeError('FormData has no HTML forms to read in Soundor');
    }
  }

  append(name, value, filename = undefined) {
    this.#entries.push([String(name), entryValue(value, filename)]);
  }

  set(name, value, filename = undefined) {
    const key = String(name);
    const entry = [key, entryValue(value, filename)];
    const index = this.#entries.findIndex(([n]) => n === key);
    if (index < 0) {
      this.#entries.push(entry);
    } else {
      this.#entries[index] = entry;
      this.#entries = this.#entries.filter(([n], i) => n !== key || i <= index);
    }
  }

  get(name) {
    const key = String(name);
    return this.#entries.find(([n]) => n === key)?.[1] ?? null;
  }

  getAll(name) {
    const key = String(name);
    return this.#entries.filter(([n]) => n === key).map(([, value]) => value);
  }

  has(name) {
    const key = String(name);
    return this.#entries.some(([n]) => n === key);
  }

  delete(name) {
    const key = String(name);
    this.#entries = this.#entries.filter(([n]) => n !== key);
  }

  forEach(callback, thisArg = undefined) {
    for (const [name, value] of [...this.#entries])
      callback.call(thisArg, value, name, this);
  }

  *entries() {
    for (const [name, value] of this.#entries) yield [name, value];
  }

  *keys() {
    for (const [name] of this.#entries) yield name;
  }

  *values() {
    for (const [, value] of this.#entries) yield value;
  }

  [Symbol.iterator]() {
    return this.entries();
  }
}
