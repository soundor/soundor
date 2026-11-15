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
} as const;
export type Command = (typeof Command)[keyof typeof Command];

/** The kinds of records in an answer. */
export const Answer = {
  Error: 1,
  Frame: 2,
  Text: 3,
} as const;

const ValueKind = {
  Number: 1,
  String: 2,
  Other: 3,
} as const;

const encoder = new TextEncoder();
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
    const { written } = encoder.encodeInto(
      value,
      this.#bytes.subarray(this.length + 4),
    );
    this.#view.setUint32(this.length, written, true);
    this.length += 4 + ((written + 3) & ~3);
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
      if (typeof value === 'number') {
        this.word(ValueKind.Number);
        this.real64(value);
      } else if (typeof value === 'string') {
        this.word(ValueKind.String);
        this.text(value);
      } else {
        this.word(ValueKind.Other);
        this.text(describe(value));
      }
      count++;
    }
    this.#view.setUint32(at, count, true);
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

/** Reads the engine's answer, in its memory. */
export class RecordReader {
  #view: DataView;
  #bytes: Uint8Array;
  #position: number;
  #end: number;

  constructor(memory: ArrayBuffer, pointer: number) {
    this.#view = new DataView(memory);
    this.#bytes = new Uint8Array(memory);
    this.#position = pointer + 4;
    this.#end = this.#position + this.#view.getUint32(pointer, true);
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
