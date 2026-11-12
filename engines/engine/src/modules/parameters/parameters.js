// `soundor:parameters` — the plugin's parameters as typed objects.
//
// Embedded into the native runtime at build time. The native side
// (`soundor:internal/parameters`, private to runtime modules) holds raw
// plain-unit values and the parameters' behavior (mapping, step, text), which
// the backend generates from soundor.config; this layer converts values to the
// declared JavaScript types, validates input, and keeps the subscriber lists.
// Subscriptions live and die with the JavaScript context, so a reload never
// leaves listeners behind.

import * as host from 'soundor:internal/parameters';

// parameters::Type and parameters::Access, in their order.
const TYPES = [
  'int8',
  'uint8',
  'int16',
  'uint16',
  'int32',
  'uint32',
  'float32',
  'boolean',
  'choice',
];
const ACCESS = ['automatable', 'manual', 'readOnly'];

/** Public, frozen metadata in the shape of the soundor.config declaration. */
function describe(raw) {
  const type = TYPES[raw.type];
  const info = {
    id: raw.id,
    label: raw.label,
    access: ACCESS[raw.access],
    type,
  };
  switch (type) {
    case 'boolean':
      info.default = raw.default >= 0.5;
      break;
    case 'choice':
      info.options = Object.freeze(
        raw.choices.map((choice) =>
          Object.freeze({ value: choice.value, label: choice.label }),
        ),
      );
      info.default = info.options[Math.round(raw.default)].value;
      break;
    default:
      info.min = raw.min;
      info.max = raw.max;
      info.default = raw.default;
      if (raw.step > 0) info.step = raw.step;
      if (raw.unit !== '') info.unit = raw.unit;
      break;
  }
  return Object.freeze(info);
}

function fromHost(info, value) {
  switch (info.type) {
    case 'boolean':
      return value >= 0.5;
    case 'choice':
      return info.options[Math.round(value)].value;
    default:
      return value;
  }
}

function toHost(info, value) {
  switch (info.type) {
    case 'boolean':
      if (typeof value !== 'boolean') {
        throw new TypeError(
          `Parameter '${info.id}' expects a boolean, got ${describeValue(value)}`,
        );
      }
      return value ? 1 : 0;
    case 'choice': {
      const index = info.options.findIndex((option) => option.value === value);
      if (index < 0) {
        throw new TypeError(
          `Parameter '${info.id}' expects one of ${info.options.map((option) => `'${option.value}'`).join(', ')}, got ${describeValue(value)}`,
        );
      }
      return index;
    }
    default:
      if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new TypeError(
          `Parameter '${info.id}' expects a number, got ${describeValue(value)}`,
        );
      }
      return value;
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

  set(value, options) {
    try {
      this.#writable();
      const next = typeof value === 'function' ? value(this.get()) : value;
      host.set(this.#index, toHost(this.#info, next), options);
    } catch (error) {
      host.fail(error);
      throw error;
    }
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

  beginGesture(options) {
    try {
      this.#writable();
      host.beginGesture(this.#index, options);
    } catch (error) {
      host.fail(error);
      throw error;
    }
  }

  endGesture() {
    host.endGesture(this.#index);
  }

  format(value) {
    return host.format(
      this.#index,
      arguments.length === 0
        ? host.get(this.#index)
        : toHost(this.#info, value),
    );
  }

  parse(text) {
    if (typeof text !== 'string') {
      throw new TypeError(
        `Parameter '${this.#info.id}': parse() expects a string, got ${describeValue(text)}`,
      );
    }
    const value = host.parse(this.#index, text);
    return value === null ? null : fromHost(this.#info, value);
  }

  toNormalized(value) {
    return host.toNormalized(
      this.#index,
      arguments.length === 0
        ? host.get(this.#index)
        : toHost(this.#info, value),
    );
  }

  fromNormalized(normalized) {
    if (typeof normalized !== 'number' || Number.isNaN(normalized)) {
      throw new TypeError(
        `Parameter '${this.#info.id}': fromNormalized() expects a number, got ${describeValue(normalized)}`,
      );
    }
    return fromHost(this.#info, host.fromNormalized(this.#index, normalized));
  }

  #writable() {
    if (this.#info.access === 'readOnly') {
      throw new TypeError(
        `Parameter '${this.#info.id}' is read-only: only the plugin's processing sets it`,
      );
    }
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
