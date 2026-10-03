// `soundor:parameters` — the plugin's parameters as typed objects.
//
// Embedded into the native runtime at build time. The native side
// (`soundor:internal/parameters`, private to runtime modules) holds raw
// plain-unit values; this layer converts them to the declared JavaScript types,
// validates input, and keeps the subscriber lists. Subscriptions live and die
// with the JavaScript context, so a reload never leaves listeners behind.

import * as host from 'soundor:internal/parameters';

const TYPES = ['float', 'int', 'bool', 'enum'];

/** Public, frozen metadata in the shape of the soundor.config declaration. */
function describe(raw) {
  const type = TYPES[raw.kind];
  const info = { id: raw.id, label: raw.label, type };
  switch (type) {
    case 'float':
    case 'int':
      info.min = raw.min;
      info.max = raw.max;
      info.default = raw.default;
      if (raw.unit !== '') info.unit = raw.unit;
      break;
    case 'bool':
      info.default = raw.default >= 0.5;
      break;
    case 'enum':
      info.values = Object.freeze([...raw.choices]);
      info.default = raw.choices[Math.round(raw.default)];
      break;
  }
  return Object.freeze(info);
}

function fromHost(info, value) {
  switch (info.type) {
    case 'float':
      return value;
    case 'int':
      return Math.round(value);
    case 'bool':
      return value >= 0.5;
    case 'enum':
      return info.values[Math.round(value)];
  }
}

function toHost(info, value) {
  switch (info.type) {
    case 'float':
    case 'int':
      if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new TypeError(
          `Parameter '${info.id}' expects a number, got ${describeValue(value)}`,
        );
      }
      return value;
    case 'bool':
      if (typeof value !== 'boolean') {
        throw new TypeError(
          `Parameter '${info.id}' expects a boolean, got ${describeValue(value)}`,
        );
      }
      return value ? 1 : 0;
    case 'enum': {
      const index = info.values.indexOf(value);
      if (index < 0) {
        throw new TypeError(
          `Parameter '${info.id}' expects one of ${info.values.map((v) => `'${v}'`).join(', ')}, got ${describeValue(value)}`,
        );
      }
      return index;
    }
  }
}

function describeValue(value) {
  return typeof value === 'string' ? `'${value}'` : String(value);
}

/** index → Set of listeners; only parameters someone listens to have an entry. */
const subscribers = new Map();

class Parameter {
  #index;
  #info;

  constructor(index, info) {
    this.#index = index;
    this.#info = info;
    Object.freeze(this);
  }

  get id() {
    return this.#info.id;
  }

  get info() {
    return this.#info;
  }

  get() {
    return fromHost(this.#info, host.get(this.#index));
  }

  set(value) {
    host.set(this.#index, toHost(this.#info, value));
  }

  subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError(
        `Parameter '${this.#info.id}': subscribe() expects a function`,
      );
    }
    let listeners = subscribers.get(this.#index);
    if (listeners === undefined) {
      listeners = new Set();
      subscribers.set(this.#index, listeners);
    }
    // Wrapped so subscribing the same function twice yields two independent
    // subscriptions, each removed by its own unsubscribe().
    const entry = { listener };
    listeners.add(entry);
    return () => {
      listeners.delete(entry);
    };
  }

  beginGesture() {
    host.beginGesture(this.#index);
  }

  endGesture() {
    host.endGesture(this.#index);
  }
}

const all = host.infos.map((raw, index) => new Parameter(index, describe(raw)));

host.setListener((index, value) => {
  const listeners = subscribers.get(index);
  if (listeners === undefined || listeners.size === 0) return;
  const converted = fromHost(all[index].info, value);
  for (const { listener } of [...listeners]) {
    try {
      listener(converted);
    } catch (error) {
      host.reportError(error);
    }
  }
});

export const parameters = Object.freeze(
  Object.fromEntries(all.map((parameter) => [parameter.id, parameter])),
);
