// A small, dependency-free value formatter for console output, in the spirit
// of Node's util.inspect: readable, bounded (depth and length), cycle-safe.

const MAX_ITEMS = 100;
const MAX_STRING = 10000;

export function inspect(value, options = {}) {
  return format(value, options.depth ?? 2, new Set(), false);
}

function format(value, depth, seen, nested) {
  switch (typeof value) {
    case 'string':
      return nested ? quote(value) : truncate(value);
    case 'number':
      return Object.is(value, -0) ? '-0' : String(value);
    case 'bigint':
      return `${value}n`;
    case 'boolean':
    case 'undefined':
      return String(value);
    case 'symbol':
      return value.toString();
    case 'function':
      return formatFunction(value);
  }
  if (value === null) return 'null';
  if (seen.has(value)) return '[Circular]';
  if (value instanceof Error) return formatError(value);
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  if (value instanceof RegExp) return String(value);
  if (value instanceof Promise) return 'Promise {}';
  if (value instanceof ArrayBuffer)
    return `ArrayBuffer { byteLength: ${value.byteLength} }`;
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return formatList(
      `${value.constructor.name}(${value.length})`,
      Array.from(value.subarray(0, MAX_ITEMS), String),
      value.length,
    );
  }

  if (depth < 0) {
    return Array.isArray(value)
      ? '[Array]'
      : `[${typeName(value) ?? 'Object'}]`;
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const items = value
        .slice(0, MAX_ITEMS)
        .map((item) => format(item, depth - 1, seen, true));
      return formatList('', items, value.length, '[', ']');
    }
    if (value instanceof Map) {
      const items = [...value]
        .slice(0, MAX_ITEMS)
        .map(
          ([key, item]) =>
            `${format(key, depth - 1, seen, true)} => ${format(item, depth - 1, seen, true)}`,
        );
      return formatList(`Map(${value.size})`, items, value.size, '{', '}');
    }
    if (value instanceof Set) {
      const items = [...value]
        .slice(0, MAX_ITEMS)
        .map((item) => format(item, depth - 1, seen, true));
      return formatList(`Set(${value.size})`, items, value.size, '{', '}');
    }
    const keys = Object.keys(value);
    const entries = keys
      .slice(0, MAX_ITEMS)
      .map(
        (key) =>
          `${formatKey(key)}: ${format(value[key], depth - 1, seen, true)}`,
      );
    const name = typeName(value);
    return formatList(name ?? '', entries, keys.length, '{', '}');
  } finally {
    seen.delete(value);
  }
}

function formatList(prefix, items, total, open = '[', close = ']') {
  if (total > items.length)
    items.push(`... ${total - items.length} more items`);
  const body =
    items.length === 0
      ? `${open}${close}`
      : `${open} ${items.join(', ')} ${close}`;
  return prefix ? `${prefix} ${body}` : body;
}

function formatFunction(fn) {
  const kind = /^class\b/.test(Function.prototype.toString.call(fn))
    ? 'class'
    : 'Function';
  return fn.name ? `[${kind}: ${fn.name}]` : `[${kind} (anonymous)]`;
}

function formatError(error) {
  const head = error.message
    ? `${error.name}: ${error.message}`
    : String(error.name);
  return error.stack ? `${head}\n${String(error.stack).trimEnd()}` : head;
}

/** The constructor name of a non-plain object, if any. */
function typeName(value) {
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null) return '[Object: null prototype]';
  if (prototype === Object.prototype) return undefined;
  const name = prototype.constructor?.name;
  return typeof name === 'string' && name !== '' ? name : undefined;
}

function formatKey(key) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : quote(key);
}

function quote(text) {
  return `'${truncate(text).replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n')}'`;
}

function truncate(text) {
  return text.length > MAX_STRING
    ? `${text.slice(0, MAX_STRING)}... ${text.length - MAX_STRING} more characters`
    : text;
}
