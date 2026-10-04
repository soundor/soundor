// fetch(), Headers, Request and Response over the backend's HTTP client.
//
// Bodies are buffered: Soundor has no Web Streams yet, so `body` streams are
// not provided and bodies are read with arrayBuffer()/bytes()/text()/json()/
// blob()/formData(). Requests always follow redirects.

import { httpAbort, httpSend } from 'soundor:internal/platform';
import { Blob, File, blobBytes } from 'soundor:internal/web/blob';
import {
  TextDecoder,
  TextEncoder,
  bytesOf,
} from 'soundor:internal/web/encoding';
import { FormData } from 'soundor:internal/web/form-data';
import { URL, URLSearchParams } from 'soundor:internal/web/url';

const encoder = new TextEncoder();

// Private-state hooks, assigned by the classes' static blocks.
let headerList;
let bodyBytes;
let setBodyBytes;
let isUsed;
let fromNetwork;

// ── Headers ──────────────────────────────────────────────────────────────────

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function headerName(name) {
  const text = String(name);
  if (!TOKEN.test(text)) throw new TypeError(`Invalid header name: '${text}'`);
  return text.toLowerCase();
}

function headerValue(value) {
  const text = String(value).replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, '');
  if (/[\u0000\r\n]/.test(text))
    throw new TypeError('Header values cannot contain NUL, CR or LF');
  return text;
}

export class Headers {
  #list = [];

  constructor(init = undefined) {
    if (init === undefined || init === null) return;
    if (init instanceof Headers) {
      this.#list = init.#list.map(([name, value]) => [name, value]);
    } else if (typeof init[Symbol.iterator] === 'function') {
      for (const pair of init) {
        const entry = [...pair];
        if (entry.length !== 2)
          throw new TypeError('Header pairs must have exactly two items');
        this.append(entry[0], entry[1]);
      }
    } else if (typeof init === 'object') {
      for (const key of Object.keys(init)) this.append(key, init[key]);
    } else {
      throw new TypeError('Headers expects pairs or a record');
    }
  }

  append(name, value) {
    this.#list.push([headerName(name), headerValue(value)]);
  }

  delete(name) {
    const key = headerName(name);
    this.#list = this.#list.filter(([n]) => n !== key);
  }

  get(name) {
    const key = headerName(name);
    const values = this.#list.filter(([n]) => n === key).map(([, v]) => v);
    return values.length === 0 ? null : values.join(', ');
  }

  getSetCookie() {
    return this.#list.filter(([n]) => n === 'set-cookie').map(([, v]) => v);
  }

  has(name) {
    const key = headerName(name);
    return this.#list.some(([n]) => n === key);
  }

  set(name, value) {
    const key = headerName(name);
    const entry = [key, headerValue(value)];
    const index = this.#list.findIndex(([n]) => n === key);
    if (index < 0) {
      this.#list.push(entry);
    } else {
      this.#list[index] = entry;
      this.#list = this.#list.filter(([n], i) => n !== key || i <= index);
    }
  }

  /** Sorted and combined, with Set-Cookie kept separate (Fetch "sort and combine"). */
  *entries() {
    const names = [...new Set(this.#list.map(([n]) => n))].sort();
    for (const name of names) {
      if (name === 'set-cookie') {
        for (const value of this.getSetCookie()) yield [name, value];
      } else {
        yield [name, this.get(name)];
      }
    }
  }

  *keys() {
    for (const [name] of this.entries()) yield name;
  }

  *values() {
    for (const [, value] of this.entries()) yield value;
  }

  forEach(callback, thisArg = undefined) {
    for (const [name, value] of this.entries())
      callback.call(thisArg, value, name, this);
  }

  [Symbol.iterator]() {
    return this.entries();
  }

  static {
    headerList = (headers) =>
      headers.#list.map(([name, value]) => [name, value]);
  }
}

// ── Bodies ───────────────────────────────────────────────────────────────────

function escapeQuoted(text) {
  return text
    .replaceAll('"', '%22')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
}

function multipart(formData) {
  const random = new Uint8Array(12);
  crypto.getRandomValues(random);
  const boundary = `----SoundorFormBoundary${Array.from(random, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  const parts = [];
  for (const [name, value] of formData) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${escapeQuoted(name)}"`;
    if (value instanceof File) {
      head += `; filename="${escapeQuoted(value.name)}"\r\nContent-Type: ${value.type || 'application/octet-stream'}`;
      parts.push(head, '\r\n\r\n', value, '\r\n');
    } else {
      parts.push(
        head,
        '\r\n\r\n',
        value.replace(/\r\n|\r|\n/g, '\r\n'),
        '\r\n',
      );
    }
  }
  parts.push(`--${boundary}--\r\n`);
  return {
    bytes: blobBytes(new Blob(parts)),
    type: `multipart/form-data; boundary=${boundary}`,
  };
}

/** Bytes and default Content-Type of a body init (Fetch "extract a body"). */
function extractBody(body) {
  if (body === null || body === undefined) return { bytes: null, type: null };
  if (typeof body === 'string') {
    return { bytes: encoder.encode(body), type: 'text/plain;charset=UTF-8' };
  }
  if (body instanceof URLSearchParams) {
    return {
      bytes: encoder.encode(body.toString()),
      type: 'application/x-www-form-urlencoded;charset=UTF-8',
    };
  }
  if (body instanceof Blob)
    return { bytes: blobBytes(body), type: body.type || null };
  if (body instanceof FormData) return multipart(body);
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return { bytes: bytesOf(body).slice(), type: null };
  }
  if (
    typeof body?.[Symbol.asyncIterator] === 'function' ||
    typeof body?.getReader === 'function'
  ) {
    throw new TypeError(
      'Streaming bodies are not supported; pass the data as a whole',
    );
  }
  return {
    bytes: encoder.encode(String(body)),
    type: 'text/plain;charset=UTF-8',
  };
}

/** The shared body-reading methods of Request and Response. */
class Body {
  #bytes;
  #used = false;

  constructor(bytes) {
    this.#bytes = bytes;
  }

  get bodyUsed() {
    return this.#used;
  }

  #consume() {
    if (this.#used) throw new TypeError('Body has already been consumed');
    this.#used = true;
    return this.#bytes ?? new Uint8Array(0);
  }

  async arrayBuffer() {
    return this.#consume().slice().buffer;
  }

  async bytes() {
    return this.#consume().slice();
  }

  async text() {
    return new TextDecoder().decode(this.#consume());
  }

  async json() {
    return JSON.parse(await this.text());
  }

  async blob() {
    return new Blob([this.#consume()], {
      type: this.headers.get('content-type') ?? '',
    });
  }

  async formData() {
    const type = this.headers.get('content-type') ?? '';
    if (!type.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
      throw new TypeError(
        'formData() supports application/x-www-form-urlencoded bodies only',
      );
    }
    const form = new FormData();
    for (const [name, value] of new URLSearchParams(await this.text()))
      form.append(name, value);
    return form;
  }

  static {
    bodyBytes = (body) => body.#bytes;
    setBodyBytes = (body, bytes) => {
      body.#bytes = bytes;
    };
    isUsed = (body) => body.#used;
  }
}

// ── Request ──────────────────────────────────────────────────────────────────

const STANDARD_METHODS = [
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'POST',
  'PUT',
  'PATCH',
];
const FORBIDDEN_METHODS = ['CONNECT', 'TRACE', 'TRACK'];

function normalizeMethod(method) {
  const text = String(method);
  if (!TOKEN.test(text)) throw new TypeError(`Invalid method: '${text}'`);
  const upper = text.toUpperCase();
  if (FORBIDDEN_METHODS.includes(upper))
    throw new TypeError(`Method ${upper} is forbidden`);
  return STANDARD_METHODS.includes(upper) ? upper : text;
}

export class Request extends Body {
  #method;
  #url;
  #headers;
  #signal;
  #redirect;

  constructor(input, init = {}) {
    const source = input instanceof Request ? input : null;
    if (source?.bodyUsed)
      throw new TypeError('Cannot construct a Request from a used Request');
    let url;
    try {
      url = new URL(source ? source.url : String(input));
    } catch {
      throw new TypeError(`Invalid URL: ${String(input)}`);
    }
    if (url.username !== '' || url.password !== '') {
      throw new TypeError('Request URLs cannot contain credentials');
    }
    const method = normalizeMethod(init.method ?? source?.method ?? 'GET');
    const headers = new Headers(init.headers ?? source?.headers);
    const body =
      init.body !== undefined
        ? extractBody(init.body)
        : { bytes: source ? bodyBytes(source) : null, type: null };
    if (body.bytes !== null && (method === 'GET' || method === 'HEAD')) {
      throw new TypeError(`A ${method} request cannot have a body`);
    }
    if (body.type !== null && !headers.has('content-type'))
      headers.set('content-type', body.type);
    super(body.bytes);

    const redirect = init.redirect ?? source?.redirect ?? 'follow';
    if (!['follow', 'error', 'manual'].includes(redirect)) {
      throw new TypeError(`Invalid redirect mode: '${redirect}'`);
    }
    this.#method = method;
    this.#url = url.href;
    this.#headers = headers;
    this.#redirect = redirect;
    const controller = new AbortController();
    const parent = init.signal === undefined ? source?.signal : init.signal;
    if (parent) {
      if (parent.aborted) controller.abort(parent.reason);
      else
        parent.addEventListener(
          'abort',
          () => controller.abort(parent.reason),
          { once: true },
        );
    }
    this.#signal = controller.signal;
  }

  get method() {
    return this.#method;
  }
  get url() {
    return this.#url;
  }
  get headers() {
    return this.#headers;
  }
  get signal() {
    return this.#signal;
  }
  get redirect() {
    return this.#redirect;
  }

  clone() {
    if (this.bodyUsed) throw new TypeError('Cannot clone a used Request');
    return new Request(this);
  }
}

// ── Response ─────────────────────────────────────────────────────────────────

const NULL_BODY_STATUSES = [101, 103, 204, 205, 304];
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

export class Response extends Body {
  #status;
  #statusText;
  #headers;
  #url = '';
  #redirected = false;
  #type = 'default';

  constructor(body = null, init = {}) {
    const status = init.status ?? 200;
    if (!Number.isInteger(status) || status < 200 || status > 599) {
      throw new RangeError(
        `Response status must be an integer from 200 to 599, got ${status}`,
      );
    }
    const statusText = String(init.statusText ?? '');
    if (/[^\t\x20-\x7E\x80-\xFF]/.test(statusText))
      throw new TypeError('Invalid statusText');
    const extracted = extractBody(body);
    if (extracted.bytes !== null && NULL_BODY_STATUSES.includes(status)) {
      throw new TypeError(
        `A response with status ${status} cannot have a body`,
      );
    }
    const headers = new Headers(init.headers);
    if (extracted.type !== null && !headers.has('content-type')) {
      headers.set('content-type', extracted.type);
    }
    super(extracted.bytes);
    this.#status = status;
    this.#statusText = statusText;
    this.#headers = headers;
  }

  get status() {
    return this.#status;
  }
  get statusText() {
    return this.#statusText;
  }
  get ok() {
    return this.#status >= 200 && this.#status <= 299;
  }
  get headers() {
    return this.#headers;
  }
  get url() {
    return this.#url;
  }
  get redirected() {
    return this.#redirected;
  }
  get type() {
    return this.#type;
  }

  clone() {
    if (this.bodyUsed) throw new TypeError('Cannot clone a used Response');
    return fromNetwork({
      status: this.#status,
      statusText: this.#statusText,
      headers: headerList(this.#headers),
      body: bodyBytes(this),
      url: this.#url,
      redirected: this.#redirected,
      type: this.#type,
    });
  }

  static error() {
    const response = new Response(null, { status: 200 });
    response.#status = 0;
    response.#type = 'error';
    return response;
  }

  static json(data, init = {}) {
    const text = JSON.stringify(data);
    if (text === undefined)
      throw new TypeError('The value cannot be serialized as JSON');
    const headers = new Headers(init.headers);
    if (!headers.has('content-type'))
      headers.set('content-type', 'application/json');
    return new Response(text, { ...init, headers });
  }

  static redirect(url, status = 302) {
    if (!REDIRECT_STATUSES.includes(status))
      throw new RangeError(`Invalid redirect status ${status}`);
    return new Response(null, {
      status,
      headers: { location: new URL(url).href },
    });
  }

  static {
    fromNetwork = (parts) => {
      // Network responses may carry statuses the constructor rejects (1xx).
      const response = new Response(null, {
        status: 200,
        headers: parts.headers,
      });
      response.#status = parts.status;
      response.#statusText = parts.statusText;
      response.#url = parts.url;
      response.#redirected = parts.redirected;
      response.#type = parts.type ?? 'basic';
      setBodyBytes(response, parts.body);
      return response;
    };
  }
}

// ── fetch() ──────────────────────────────────────────────────────────────────

function decodeDataUrl(url) {
  const comma = url.pathname.indexOf(',');
  if (comma < 0) throw new TypeError('Invalid data: URL');
  const header = url.pathname.slice(0, comma);
  const payload = decodeURIComponent(
    url.pathname.slice(comma + 1) + url.search,
  );
  const isBase64 = /;base64$/i.test(header);
  const type =
    (isBase64 ? header.slice(0, -7) : header) || 'text/plain;charset=US-ASCII';
  const bytes = isBase64
    ? Uint8Array.from(atob(payload.replace(/\s+/g, '')), (c) => c.charCodeAt(0))
    : encoder.encode(payload);
  return fromNetwork({
    status: 200,
    statusText: 'OK',
    headers: [['content-type', type]],
    body: bytes,
    url: url.href,
    redirected: false,
  });
}

export function fetch(input, init = {}) {
  return new Promise((resolve, reject) => {
    const request = new Request(input, init);
    const { signal } = request;
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const url = new URL(request.url);
    if (url.protocol === 'data:') {
      resolve(decodeDataUrl(url));
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      reject(new TypeError(`fetch() does not support ${url.protocol} URLs`));
      return;
    }
    if (request.redirect !== 'follow') {
      reject(
        new TypeError(`Redirect mode '${request.redirect}' is not supported`),
      );
      return;
    }
    if (isUsed(request)) {
      reject(new TypeError('The request body has already been consumed'));
      return;
    }
    const [response, id] = httpSend(
      request.method,
      request.url,
      headerList(request.headers),
      bodyBytes(request),
    );
    const onAbort = () => {
      httpAbort(id);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    response.then(
      (parts) => {
        signal.removeEventListener('abort', onAbort);
        try {
          resolve(
            fromNetwork({
              ...parts,
              redirected: parts.url !== '' && parts.url !== request.url,
            }),
          );
        } catch (error) {
          reject(
            new TypeError(`fetch failed: invalid response (${error.message})`),
          );
        }
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        if (!signal.aborted) reject(error);
      },
    );
  });
}
