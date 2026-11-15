// The encoding of what crosses between JavaScript and the WebAssembly engine
// (wasm/Engine.h): commands written here into one buffer, run by one call,
// answered by records of what changed. 32-bit little-endian words; a string
// is its UTF-8 byte count, then its bytes padded to a whole word.

export const Command = {
  Create: 1,
  Release: 2,
  Insert: 3,
  Remove: 4,
  Style: 5,
  Text: 6,
  Size: 7,
  Scale: 8,
  Layout: 9,
  Placeholder: 10,
  Natural: 11,
  Fonts: 12,
  Extent: 13,
  Check: 14,
} as const;
export type Command = (typeof Command)[keyof typeof Command];

/** The kinds of records in an answer. */
export const Answer = {
  Error: 1,
  Frame: 2,
  Text: 3,
  Extent: 4,
} as const;

/** The node types, as the engine numbers them (wasm/Engine.h's NodeKind). */
export const NodeKind = {
  view: 0,
  text: 1,
  image: 2,
  input: 3,
  canvas: 4,
  svg: 5,
} as const;

const ValueKind = {
  Number: 1,
  String: 2,
  Other: 3,
  Boolean: 4,
  Array: 5,
  Object: 6,
} as const;

/** How deep a style's arrays and objects are sent (`transform`, `boxShadow`). */
const MAX_DEPTH = 4;

const encoder = new TextEncoder();
/** Strings this long or shorter are tried as ASCII first. */
const SHORT = 64;
const decoder = new TextDecoder();

/** Commands, written into a buffer that grows. */
export class CommandWriter {
  #bytes = new Uint8Array(4096);
  #view = new DataView(this.#bytes.buffer);
  /** Bytes written. */
  length = 0;
  /** Commands written: an error names its command by this index. */
  count = 0;

  /** Starts a command; returns its index. */
  command(command: Command): number {
    this.word(command);
    return this.count++;
  }

  word(value: number): void {
    this.#reserve(4);
    this.#view.setUint32(this.length, value, true);
    this.length += 4;
  }

  real(value: number): void {
    this.#reserve(4);
    this.#view.setFloat32(this.length, value, true);
    this.length += 4;
  }

  real64(value: number): void {
    this.#reserve(8);
    this.#view.setFloat64(this.length, value, true);
    this.length += 8;
  }

  text(value: string): void {
    // At most three bytes per UTF-16 unit, a padded word after the count.
    this.#reserve(8 + value.length * 3);
    let written = value.length <= SHORT ? this.#ascii(value) : -1;
    if (written < 0)
      written = encoder.encodeInto(
        value,
        this.#bytes.subarray(this.length + 4),
      ).written;
    this.#view.setUint32(this.length, written, true);
    this.length += 4 + ((written + 3) & ~3);
  }

  /**
   * Writes a short string's bytes after the count, if it is ASCII (style
   * keys and most values): encodeInto() costs more than the copy for those.
   * -1 if it is not.
   */
  #ascii(value: string): number {
    const bytes = this.#bytes;
    const at = this.length + 4;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code >= 0x80) return -1;
      bytes[at + i] = code;
    }
    return value.length;
  }

  /** A style object's own properties, as the engine reads them. */
  style(style: object): void {
    const at = this.length;
    this.word(0);
    let count = 0;
    for (const key in style) {
      if (!Object.hasOwn(style, key)) continue;
      const value: unknown = (style as Record<string, unknown>)[key];
      if (value === undefined || value === null) continue;
      this.text(key);
      this.value(value, 0);
      count++;
    }
    this.#view.setUint32(at, count, true);
  }

  /**
   * A value as the engine reads it: numbers, strings and booleans as they
   * are, arrays and plain objects with what is in them (a few levels deep),
   * anything else as String() shows it and its type, for error messages.
   */
  value(value: unknown, depth: number): void {
    switch (typeof value) {
      case 'number':
        this.word(ValueKind.Number);
        this.real64(value);
        return;
      case 'string':
        this.word(ValueKind.String);
        this.text(value);
        return;
      case 'boolean':
        this.word(ValueKind.Boolean);
        this.word(value ? 1 : 0);
        return;
    }
    if (depth < MAX_DEPTH && Array.isArray(value)) {
      this.word(ValueKind.Array);
      this.text(describe(value));
      this.word(value.length);
      for (const item of value as unknown[]) this.value(item, depth + 1);
      return;
    }
    if (
      depth < MAX_DEPTH &&
      typeof value === 'object' &&
      value !== null &&
      !ArrayBuffer.isView(value) &&
      !(value instanceof ArrayBuffer)
    ) {
      this.word(ValueKind.Object);
      this.text(describe(value));
      const at = this.length;
      this.word(0);
      let count = 0;
      for (const key in value) {
        // Every key, as natively: one whose value is undefined or null is
        // there, but counts as absent where a value is looked for.
        this.text(key);
        this.value((value as Record<string, unknown>)[key], depth + 1);
        count++;
      }
      this.#view.setUint32(at, count, true);
      return;
    }
    this.word(ValueKind.Other);
    this.text(describe(value));
    this.text(typeName(value));
  }

  /** What was written. */
  get bytes(): Uint8Array {
    return this.#bytes.subarray(0, this.length);
  }

  reset(): void {
    this.length = 0;
    this.count = 0;
  }

  #reserve(size: number): void {
    if (this.length + size <= this.#bytes.length) return;
    let capacity = this.#bytes.length * 2;
    while (capacity < this.length + size) capacity *= 2;
    const bytes = new Uint8Array(capacity);
    bytes.set(this.#bytes.subarray(0, this.length));
    this.#bytes = bytes;
    this.#view = new DataView(bytes.buffer);
  }
}

/** A value as String() shows it, for error messages. */
function describe(value: unknown): string {
  try {
    return String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/** A value's type, as soundor:ui's errors name it. */
function typeName(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'function') return 'function';
  if (typeof value !== 'object') return typeof value;
  if (Array.isArray(value)) return 'array';
  if (value instanceof ArrayBuffer) return 'ArrayBuffer';
  if (ArrayBuffer.isView(value)) return 'typed array';
  return 'object';
}

/** Reads the engine's answer, in its memory. */
export class RecordReader {
  #buffer: ArrayBuffer | null = null;
  #view = new DataView(new ArrayBuffer(0));
  #bytes = new Uint8Array(0);
  #position = 0;
  #end = 0;

  /**
   * Starts reading an answer at `pointer` in `memory`. The views over the
   * memory are kept from one answer to the next while it stays the same
   * buffer (it is a new one once the memory grows).
   */
  read(memory: ArrayBuffer, pointer: number): this {
    this.view(memory);
    this.#position = pointer + 4;
    this.#end = this.#position + this.#view.getUint32(pointer, true);
    return this;
  }

  /** The bytes of `memory`, viewed as answers are. */
  view(memory: ArrayBuffer): Uint8Array {
    if (memory !== this.#buffer) {
      this.#buffer = memory;
      this.#view = new DataView(memory);
      this.#bytes = new Uint8Array(memory);
    }
    return this.#bytes;
  }

  get done(): boolean {
    return this.#position >= this.#end;
  }

  word(): number {
    const value = this.#view.getUint32(this.#position, true);
    this.#position += 4;
    return value;
  }

  real(): number {
    const value = this.#view.getFloat32(this.#position, true);
    this.#position += 4;
    return value;
  }

  text(): string {
    const length = this.word();
    const value = decoder.decode(
      this.#bytes.subarray(this.#position, this.#position + length),
    );
    this.#position += (length + 3) & ~3;
    return value;
  }
}
