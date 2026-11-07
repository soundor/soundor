// URL and URLSearchParams (WHATWG URL Standard). Parsing and setters are ada's;
// URLSearchParams is the standard's application/x-www-form-urlencoded parser
// and serializer.

import { urlParse, urlSet } from 'soundor:internal/platform';
import { TextDecoder, TextEncoder } from 'soundor:internal/web/encoding';

const HREF = 0;
const ORIGIN = 1;
const PROTOCOL = 2;
const USERNAME = 3;
const PASSWORD = 4;
const HOST = 5;
const HOSTNAME = 6;
const PORT = 7;
const PATHNAME = 8;
const SEARCH = 9;
const HASH = 10;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Links a URL to its searchParams without public API. */
let attachParams;
let setParamsFromQuery;

export class URL {
  #parts;
  #params = null;

  constructor(url, base = undefined) {
    const parts = urlParse(
      String(url),
      base === undefined ? undefined : String(base),
    );
    if (parts === null) throw new TypeError(`Invalid URL: ${String(url)}`);
    this.#parts = parts;
  }

  static canParse(url, base = undefined) {
    return (
      urlParse(String(url), base === undefined ? undefined : String(base)) !==
      null
    );
  }

  static parse(url, base = undefined) {
    try {
      return new URL(url, base);
    } catch {
      return null;
    }
  }

  #set(component, value) {
    const parts = urlSet(this.#parts[HREF], component, String(value));
    if (parts === null) throw new TypeError(`Invalid URL: ${String(value)}`);
    this.#parts = parts;
    if (component === 'href' || component === 'search') {
      setParamsFromQuery?.(this.#params, this.#parts[SEARCH]);
    }
  }

  get href() {
    return this.#parts[HREF];
  }
  set href(value) {
    this.#set('href', value);
  }
  get origin() {
    return this.#parts[ORIGIN];
  }
  get protocol() {
    return this.#parts[PROTOCOL];
  }
  set protocol(value) {
    this.#set('protocol', value);
  }
  get username() {
    return this.#parts[USERNAME];
  }
  set username(value) {
    this.#set('username', value);
  }
  get password() {
    return this.#parts[PASSWORD];
  }
  set password(value) {
    this.#set('password', value);
  }
  get host() {
    return this.#parts[HOST];
  }
  set host(value) {
    this.#set('host', value);
  }
  get hostname() {
    return this.#parts[HOSTNAME];
  }
  set hostname(value) {
    this.#set('hostname', value);
  }
  get port() {
    return this.#parts[PORT];
  }
  set port(value) {
    this.#set('port', value);
  }
  get pathname() {
    return this.#parts[PATHNAME];
  }
  set pathname(value) {
    this.#set('pathname', value);
  }
  get search() {
    return this.#parts[SEARCH];
  }
  set search(value) {
    this.#set('search', value);
  }
  get hash() {
    return this.#parts[HASH];
  }
  set hash(value) {
    this.#set('hash', value);
  }

  get searchParams() {
    if (this.#params === null) {
      this.#params = new URLSearchParams(this.#parts[SEARCH]);
      attachParams(this.#params, (query) => {
        this.#parts = urlSet(this.#parts[HREF], 'search', query);
      });
    }
    return this.#params;
  }

  toString() {
    return this.href;
  }
  toJSON() {
    return this.href;
  }
}

// ── application/x-www-form-urlencoded ────────────────────────────────────────

function percentDecode(text) {
  const bytes = encoder.encode(text);
  const out = new Uint8Array(bytes.length);
  let length = 0;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === 0x25 && i + 2 < bytes.length) {
      const hex = String.fromCharCode(bytes[i + 1], bytes[i + 2]);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        out[length++] = Number.parseInt(hex, 16);
        i += 2;
        continue;
      }
    }
    out[length++] = byte;
  }
  return decoder.decode(out.subarray(0, length));
}

function parseQuery(query) {
  const pairs = [];
  for (const sequence of query.split('&')) {
    if (sequence === '') continue;
    const equals = sequence.indexOf('=');
    const name = equals < 0 ? sequence : sequence.slice(0, equals);
    const value = equals < 0 ? '' : sequence.slice(equals + 1);
    pairs.push([
      percentDecode(name.replaceAll('+', ' ')),
      percentDecode(value.replaceAll('+', ' ')),
    ]);
  }
  return pairs;
}

const SAFE = /[A-Za-z0-9*\-._]/;

function serializeComponent(text) {
  let out = '';
  for (const byte of encoder.encode(text)) {
    const char = String.fromCharCode(byte);
    if (byte === 0x20) out += '+';
    else if (byte < 0x80 && SAFE.test(char)) out += char;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/** USVString conversion: lone surrogates become U+FFFD. */
function usv(value) {
  return String(value).toWellFormed();
}

export class URLSearchParams {
  #pairs = [];
  #onChange = null;

  constructor(init = '') {
    if (init instanceof URLSearchParams) {
      this.#pairs = init.#pairs.map(([name, value]) => [name, value]);
    } else if (
      typeof init === 'object' &&
      init !== null &&
      typeof init[Symbol.iterator] === 'function'
    ) {
      for (const pair of init) {
        const entry = [...pair];
        if (entry.length !== 2) {
          throw new TypeError(
            'URLSearchParams pairs must have exactly two items',
          );
        }
        this.#pairs.push([usv(entry[0]), usv(entry[1])]);
      }
    } else if (typeof init === 'object' && init !== null) {
      for (const key of Object.keys(init))
        this.#pairs.push([usv(key), usv(init[key])]);
    } else {
      const query = usv(init);
      this.#pairs = parseQuery(query.startsWith('?') ? query.slice(1) : query);
    }
  }

  static {
    attachParams = (params, onChange) => {
      params.#onChange = onChange;
    };
    setParamsFromQuery = (params, search) => {
      if (params !== null)
        params.#pairs = parseQuery(
          search.startsWith('?') ? search.slice(1) : search,
        );
    };
  }

  #update() {
    if (this.#onChange) this.#onChange(this.toString());
  }

  get size() {
    return this.#pairs.length;
  }

  append(name, value) {
    this.#pairs.push([usv(name), usv(value)]);
    this.#update();
  }

  delete(name, value = undefined) {
    const key = usv(name);
    const match = value === undefined ? undefined : usv(value);
    this.#pairs = this.#pairs.filter(
      ([n, v]) => n !== key || (match !== undefined && v !== match),
    );
    this.#update();
  }

  get(name) {
    const key = usv(name);
    return this.#pairs.find(([n]) => n === key)?.[1] ?? null;
  }

  getAll(name) {
    const key = usv(name);
    return this.#pairs.filter(([n]) => n === key).map(([, v]) => v);
  }

  has(name, value = undefined) {
    const key = usv(name);
    const match = value === undefined ? undefined : usv(value);
    return this.#pairs.some(
      ([n, v]) => n === key && (match === undefined || v === match),
    );
  }

  set(name, value) {
    const key = usv(name);
    const index = this.#pairs.findIndex(([n]) => n === key);
    if (index < 0) {
      this.#pairs.push([key, usv(value)]);
    } else {
      this.#pairs[index] = [key, usv(value)];
      this.#pairs = this.#pairs.filter(([n], i) => n !== key || i <= index);
    }
    this.#update();
  }

  sort() {
    // Stable sort by UTF-16 code units, as the standard requires.
    this.#pairs = this.#pairs
      .map((pair, index) => [pair, index])
      .sort(([[a], i], [[b], j]) => (a < b ? -1 : a > b ? 1 : i - j))
      .map(([pair]) => pair);
    this.#update();
  }

  forEach(callback, thisArg = undefined) {
    for (const [name, value] of [...this.#pairs])
      callback.call(thisArg, value, name, this);
  }

  *entries() {
    for (const [name, value] of this.#pairs) yield [name, value];
  }

  *keys() {
    for (const [name] of this.#pairs) yield name;
  }

  *values() {
    for (const [, value] of this.#pairs) yield value;
  }

  [Symbol.iterator]() {
    return this.entries();
  }

  toString() {
    return this.#pairs
      .map(
        ([name, value]) =>
          `${serializeComponent(name)}=${serializeComponent(value)}`,
      )
      .join('&');
  }
}
