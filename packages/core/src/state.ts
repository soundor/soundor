import { StateHistory, type HistoryOptions } from './history';
export * from './history';
/** Portable persistent values and the versioned Soundor snapshot wire format. */
import {
  describeNativeApi,
  type NativeApiDeclaration,
  type NativeApiModel,
  type NativeType,
} from './native-api';
import { resolveSetter, type ValueOrUpdater } from './setter';

export { resolveSetter, type ValueOrUpdater } from './setter';

export interface StateDeclaration {
  readonly type: string;
  readonly default: unknown;
  /**
   * Whether the Rust audio processor reads this field (`ctx.state`). A field
   * the processor reads is a number, a boolean, or an array of them with a
   * `maxLength`. Defaults to `false`.
   */
  readonly audio?: boolean;
  /**
   * For an array: the most elements it holds, which every value is checked
   * against. Required for an array the processor reads (`audio: true`),
   * whose storage is allocated for it.
   */
  readonly maxLength?: number;
}
export type StateDeclarations = Readonly<Record<string, StateDeclaration>>;
export interface StateField {
  readonly name: string;
  readonly type: NativeType;
  readonly default: unknown;
  /** The audio processor reads it (`audio: true`). */
  readonly audio?: boolean;
  /** An array's capacity (`maxLength`). */
  readonly maxLength?: number;
}
export interface StateSchema {
  readonly fields: readonly StateField[];
  readonly types: NativeApiModel['types'];
}
export type StateValue<
  Ref extends string,
  Types extends NonNullable<NativeApiDeclaration['types']>,
> = Ref extends `${infer T}?`
  ? StateValue<T, Types> | null
  : Ref extends `${infer T}[]`
    ? StateValue<T, Types>[]
    : Ref extends 'boolean'
      ? boolean
      : Ref extends 'string'
        ? string
        : Ref extends 'int64' | 'uint64'
          ? bigint
          : Ref extends
                | 'int8'
                | 'uint8'
                | 'int16'
                | 'uint16'
                | 'int32'
                | 'uint32'
                | 'float32'
                | 'float64'
            ? number
            : Ref extends keyof Types
              ? Types[Ref] extends {
                  readonly struct: infer S extends Readonly<
                    Record<string, string>
                  >;
                }
                ? { -readonly [K in keyof S]: StateValue<S[K], Types> }
                : Types[Ref] extends { readonly enum: readonly (infer E)[] }
                  ? E
                  : never
              : never;
export type CheckedState<
  S extends StateDeclarations,
  N extends NativeApiDeclaration,
> = {
  readonly [K in keyof S]: {
    readonly type: S[K]['type'];
    readonly default: StateValue<S[K]['type'], NonNullable<N['types']>>;
    readonly audio?: boolean;
    readonly maxLength?: number;
  };
};
export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
/** The most elements a state array's `maxLength` may declare. */
export const MAX_STATE_ARRAY_LENGTH = 1 << 20;
export interface SoundorSnapshot {
  readonly version: 1;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly state: Readonly<Record<string, unknown>>;
}

export function describeState(
  declaration: StateDeclarations = {},
  native?: NativeApiDeclaration,
): StateSchema {
  if (!record(declaration)) throw new TypeError('state: expected an object');
  const refs: Record<string, string> = {};
  for (const [name, field] of Object.entries(declaration).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    if (
      [
        'onRestored',
        'constructor',
        'store',
        'storage',
        'snapshot',
        'prepare',
        'apply',
      ].includes(name)
    )
      throw new TypeError(`state.${name}: reserved state field name`);
    if (
      !record(field) ||
      typeof field.type !== 'string' ||
      !Object.hasOwn(field, 'default')
    )
      throw new TypeError(`state.${name}: requires type and default`);
    if (
      Object.keys(field).some(
        (k) => !['type', 'default', 'audio', 'maxLength'].includes(k),
      )
    )
      throw new TypeError(`state.${name}: unknown declaration property`);
    if (field.audio !== undefined && typeof field.audio !== 'boolean')
      throw new TypeError(`state.${name}.audio: expected a boolean`);
    if (
      field.maxLength !== undefined &&
      (typeof field.maxLength !== 'number' ||
        !Number.isInteger(field.maxLength) ||
        field.maxLength < 1 ||
        field.maxLength > MAX_STATE_ARRAY_LENGTH)
    )
      throw new TypeError(
        `state.${name}.maxLength: expected an integer from 1 to ${MAX_STATE_ARRAY_LENGTH}`,
      );
    refs[name] = field.type;
  }
  // Resolve references through exactly the native registry and parser.
  const result = describeNativeApi({
    types: native?.types,
    methods: { stateFields: { args: refs } },
  });
  if (!result.ok)
    throw new TypeError(
      result.issues
        .map(
          (i) =>
            `${i.path.replace('native.methods.stateFields.args', 'state')}: ${i.message}`,
        )
        .join('\n'),
    );
  const schema: StateSchema = {
    fields: result.model.methods[0]!.args.map((f) => {
      const { audio, maxLength } = declaration[f.name]!;
      return {
        ...f,
        default: declaration[f.name]!.default,
        ...(audio === true ? { audio } : {}),
        ...(maxLength !== undefined ? { maxLength } : {}),
      };
    }),
    types: result.model.types,
  };
  const used = new Set<string>();
  const visit = (type: NativeType): void => {
    if (type.kind === 'void' || type.kind === 'buffer')
      throw new TypeError('state: buffers and void are not persistent types');
    if (type.kind === 'nullable') visit(type.inner);
    if (type.kind === 'array') visit(type.element);
    if (type.kind === 'declared' && !used.has(type.name)) {
      used.add(type.name);
      const decl = schema.types.find((t) => t.name === type.name)!;
      if (decl.kind === 'struct') decl.fields.forEach((f) => visit(f.type));
    }
  };
  schema.fields.forEach((f) => visit(f.type));
  for (const f of schema.fields) {
    if (f.maxLength !== undefined && f.type.kind !== 'array')
      throw new TypeError(
        `state.${f.name}.maxLength: only an array has a maxLength`,
      );
    if (f.audio === true) checkAudioField(f);
  }
  const resolved: StateSchema = {
    ...schema,
    types: schema.types.filter((t) => used.has(t.name)),
    fields: schema.fields.map((f) => ({
      ...f,
      default: stateFieldValue(schema, f, f.default, `state.${f.name}.default`),
    })),
  };
  const size = describeAudioState(resolved).size;
  if (size > MAX_SNAPSHOT_BYTES)
    throw new TypeError(
      `state: the fields the audio processor reads take ${size} bytes, more than ${MAX_SNAPSHOT_BYTES}`,
    );
  return resolved;
}

/** The numbers and booleans a field the audio processor reads may hold. */
export const AUDIO_STATE_ELEMENTS = [
  'boolean',
  'int8',
  'uint8',
  'int16',
  'uint16',
  'int32',
  'uint32',
  'int64',
  'uint64',
  'float32',
  'float64',
] as const;
export type AudioStateElement = (typeof AUDIO_STATE_ELEMENTS)[number];

function audioElement(type: NativeType): AudioStateElement | undefined {
  return type.kind === 'primitive' &&
    (AUDIO_STATE_ELEMENTS as readonly string[]).includes(type.name)
    ? (type.name as AudioStateElement)
    : undefined;
}

function checkAudioField(field: StateField): void {
  const path = `state.${field.name}`;
  const supported = `the audio processor reads a number or boolean (${AUDIO_STATE_ELEMENTS.join(', ')}), or an array of them with a maxLength`;
  if (field.type.kind === 'array') {
    if (audioElement(field.type.element) === undefined)
      throw new TypeError(
        `${path}: '${typeName(field.type)}' cannot be audio state; ${supported}`,
      );
    if (field.maxLength === undefined)
      throw new TypeError(
        `${path}: an array the audio processor reads needs maxLength, the most elements it holds: its storage is allocated for it`,
      );
    return;
  }
  if (audioElement(field.type) === undefined)
    throw new TypeError(
      `${path}: '${typeName(field.type)}' cannot be audio state; ${supported}`,
    );
}

function typeName(type: NativeType): string {
  switch (type.kind) {
    case 'primitive':
      return type.name;
    case 'declared':
      return type.name;
    case 'array':
      return `${typeName(type.element)}[]`;
    case 'nullable':
      return `${typeName(type.inner)}?`;
    default:
      return type.kind;
  }
}

/** One field of the audio processor's state, where its binary snapshot holds it. */
export type AudioStateField =
  | {
      readonly name: string;
      readonly kind: 'value';
      readonly element: AudioStateElement;
      /** Where the value is. */
      readonly offset: number;
      readonly default: number | bigint | boolean;
    }
  | {
      readonly name: string;
      readonly kind: 'array';
      readonly element: AudioStateElement;
      readonly maxLength: number;
      /** Where the array is: its length, a uint32, then its elements. */
      readonly offset: number;
      /** Where its elements start. */
      readonly dataOffset: number;
      readonly default: readonly (number | bigint | boolean)[];
    };

/**
 * The state the audio processor reads, as one binary snapshot: the
 * `audio: true` fields in name order, laid out as a C struct (Rust's
 * `#[repr(C)]`), each array a struct of its length (uint32) and `maxLength`
 * elements. Every runtime writes it, and the Rust SDK reads it, with this
 * layout.
 */
export interface AudioStateLayout {
  readonly fields: readonly AudioStateField[];
  /** The snapshot's size in bytes, a multiple of `align`; 0 without fields. */
  readonly size: number;
  readonly align: number;
}

/** Bytes per element, which is also its alignment. */
export const AUDIO_STATE_ELEMENT_SIZE: Readonly<
  Record<AudioStateElement, number>
> = {
  boolean: 1,
  int8: 1,
  uint8: 1,
  int16: 2,
  uint16: 2,
  int32: 4,
  uint32: 4,
  int64: 8,
  uint64: 8,
  float32: 4,
  float64: 8,
};

const roundUp = (value: number, align: number) =>
  Math.ceil(value / align) * align;

export function describeAudioState(schema: StateSchema): AudioStateLayout {
  const fields: AudioStateField[] = [];
  let offset = 0;
  let align = 1;
  for (const field of schema.fields) {
    if (field.audio !== true) continue;
    if (field.type.kind === 'array') {
      const element = audioElement(field.type.element)!;
      const size = AUDIO_STATE_ELEMENT_SIZE[element];
      const arrayAlign = Math.max(4, size);
      const maxLength = field.maxLength!;
      offset = roundUp(offset, arrayAlign);
      const dataOffset = offset + roundUp(4, size);
      fields.push({
        name: field.name,
        kind: 'array',
        element,
        maxLength,
        offset,
        dataOffset,
        default: field.default as readonly (number | bigint | boolean)[],
      });
      offset = roundUp(dataOffset + size * maxLength, arrayAlign);
      align = Math.max(align, arrayAlign);
    } else {
      const element = audioElement(field.type)!;
      const size = AUDIO_STATE_ELEMENT_SIZE[element];
      offset = roundUp(offset, size);
      fields.push({
        name: field.name,
        kind: 'value',
        element,
        offset,
        default: field.default as number | bigint | boolean,
      });
      offset += size;
      align = Math.max(align, size);
    }
  }
  return { fields, size: roundUp(offset, align), align };
}

/**
 * Writes `values` (a field name to its value, as the store holds them) into
 * `bytes`, the snapshot `layout` describes. An array's elements past its
 * length are left as they are.
 */
export function writeAudioState(
  layout: AudioStateLayout,
  values: Readonly<Record<string, unknown>>,
  bytes: DataView,
): void {
  for (const field of layout.fields) {
    const value = values[field.name];
    if (field.kind === 'value') {
      writeElement(bytes, field.offset, field.element, value);
      continue;
    }
    const items = value as readonly unknown[];
    const length = Math.min(items.length, field.maxLength);
    bytes.setUint32(field.offset, length, true);
    const size = AUDIO_STATE_ELEMENT_SIZE[field.element];
    for (let index = 0; index < length; index++)
      writeElement(
        bytes,
        field.dataOffset + index * size,
        field.element,
        items[index],
      );
  }
}

function writeElement(
  bytes: DataView,
  offset: number,
  element: AudioStateElement,
  value: unknown,
): void {
  switch (element) {
    case 'boolean':
      return bytes.setUint8(offset, value === true ? 1 : 0);
    case 'int8':
      return bytes.setInt8(offset, value as number);
    case 'uint8':
      return bytes.setUint8(offset, value as number);
    case 'int16':
      return bytes.setInt16(offset, value as number, true);
    case 'uint16':
      return bytes.setUint16(offset, value as number, true);
    case 'int32':
      return bytes.setInt32(offset, value as number, true);
    case 'uint32':
      return bytes.setUint32(offset, value as number, true);
    case 'int64':
      return bytes.setBigInt64(offset, value as bigint, true);
    case 'uint64':
      return bytes.setBigUint64(offset, value as bigint, true);
    case 'float32':
      return bytes.setFloat32(offset, value as number, true);
    case 'float64':
      return bytes.setFloat64(offset, value as number, true);
  }
}

/**
 * A field's value, validated and detached as {@link stateValue} does, and
 * checked against the field's `maxLength`.
 */
export function stateFieldValue(
  schema: StateSchema,
  field: StateField,
  value: unknown,
  path: string,
  wire = false,
): unknown {
  const checked = stateValue(schema, field.type, value, path, wire);
  if (
    field.maxLength !== undefined &&
    Array.isArray(checked) &&
    checked.length > field.maxLength
  )
    throw new RangeError(
      `${path}: ${checked.length} elements, more than its maxLength of ${field.maxLength}`,
    );
  return checked;
}

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate and detach a value. int64/uint64 use decimal strings on the wire. */
export function stateValue(
  schema: StateSchema,
  type: NativeType,
  value: unknown,
  path: string,
  wire = false,
  depth = 0,
  budget = { left: 100000 },
): unknown {
  if (depth > 64 || --budget.left < 0)
    throw new RangeError(`${path}: state value exceeds resource limits`);
  const fail = (): never => {
    throw new TypeError(
      `${path}: invalid ${type.kind === 'primitive' ? type.name : type.kind} value`,
    );
  };
  const child = (t: NativeType, v: unknown, p: string) =>
    stateValue(schema, t, v, p, wire, depth + 1, budget);
  switch (type.kind) {
    case 'nullable':
      return value === null ? null : child(type.inner, value, path);
    case 'array':
      if (!Array.isArray(value) || value.length > budget.left) return fail();
      return Object.freeze(
        Array.from(value, (v, i) => child(type.element, v, `${path}[${i}]`)),
      );
    case 'declared': {
      const decl = schema.types.find((t) => t.name === type.name)!;
      if (decl.kind === 'enum')
        return typeof value === 'string' && decl.values.includes(value)
          ? value
          : fail();
      if (!record(value)) return fail();
      const object = value;
      if (
        Object.keys(object).length !== decl.fields.length ||
        decl.fields.some((f) => !Object.hasOwn(object, f.name))
      )
        return fail();
      return Object.freeze(
        Object.fromEntries(
          decl.fields.map((f) => [
            f.name,
            child(f.type, object[f.name], `${path}.${f.name}`),
          ]),
        ),
      );
    }
    case 'primitive': {
      const name = type.name;
      if (name === 'boolean')
        return typeof value === 'boolean' ? value : fail();
      if (name === 'string')
        return typeof value === 'string' &&
          !value.includes('\0') &&
          !Array.from(value).some((c) => {
            const n = c.codePointAt(0)!;
            return n >= 0xd800 && n <= 0xdfff;
          }) &&
          value.length <= MAX_SNAPSHOT_BYTES
          ? value
          : fail();
      if (name === 'int64' || name === 'uint64') {
        if (
          wire &&
          typeof value === 'string' &&
          /^-?(0|[1-9][0-9]*)$/.test(value) &&
          value.length <= 21
        )
          value = BigInt(value);
        if (
          typeof value !== 'bigint' ||
          (name === 'int64'
            ? value < -(1n << 63n) || value >= 1n << 63n
            : value < 0n || value >= 1n << 64n)
        )
          return fail();
        return value;
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) return fail();
      if (name === 'float64') return Object.is(value, -0) ? 0 : value;
      if (name === 'float32')
        return Number.isFinite(Math.fround(value))
          ? Math.fround(value) || 0
          : fail();
      const unsigned = name.startsWith('u');
      const bits = Number(name.replace(/\D/g, ''));
      const min = unsigned ? 0 : -(2 ** (bits - 1));
      const max = unsigned ? 2 ** bits - 1 : 2 ** (bits - 1) - 1;
      return Number.isInteger(value) && value >= min && value <= max
        ? value || 0
        : fail();
    }
    default:
      throw new TypeError(
        `${path}: buffers and void are not persistent state types`,
      );
  }
}

export function stateJson(value: unknown): string {
  const json = JSON.stringify(value, (_key, v: unknown) =>
    typeof v === 'bigint' ? v.toString() : v,
  );
  if (
    json === undefined ||
    new TextEncoder().encode(json).length > MAX_SNAPSHOT_BYTES
  )
    throw new RangeError('Soundor snapshot exceeds 8 MiB');
  return json;
}
export function readSnapshot(text: string): SoundorSnapshot {
  if (new TextEncoder().encode(text).length > MAX_SNAPSHOT_BYTES)
    throw new RangeError('Soundor snapshot exceeds 8 MiB');
  let depth = 0,
    nodes = 0,
    quoted = false,
    escaped = false;
  for (const c of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === '{' || c === '[') {
      if (++depth > 64) throw new RangeError('Soundor snapshot nesting limit');
    } else if (c === '}' || c === ']') depth--;
    else if (c === ',' && ++nodes > 100000)
      throw new RangeError('Soundor snapshot element limit');
  }
  const v: unknown = JSON.parse(text);
  if (
    !record(v) ||
    v.version !== 1 ||
    !record(v.parameters) ||
    !record(v.state) ||
    Object.keys(v).some((k) => !['version', 'parameters', 'state'].includes(k))
  )
    throw new TypeError('Invalid or unsupported Soundor snapshot');
  return v as unknown as SoundorSnapshot;
}

export interface StateCell<T = unknown> {
  get(): T;
  set(value: ValueOrUpdater<T>, options?: HistoryOptions): void;
  beginGesture(options?: HistoryOptions): void;
  endGesture(): void;
  subscribe(listener: (value: T) => void): () => void;
}
export class StateStore {
  readonly fields: Readonly<Record<string, StateCell>>;
  readonly #gestures = new Map<string, number>();
  readonly #values = new Map<string, unknown>();
  readonly #listeners = new Map<string, Set<(value: unknown) => void>>();
  readonly #restored = new Set<() => void>();
  // Notifications are serialized even when a listener writes another value.
  // Writes themselves still commit immediately; this queue stages no state.
  readonly #notifications: {
    listeners: readonly ((value: unknown) => void)[];
    value: unknown;
  }[] = [];
  #notifying = false;
  constructor(
    readonly schema: StateSchema,
    readonly history = new StateHistory(),
  ) {
    this.fields = Object.freeze(
      Object.fromEntries(
        schema.fields.map((f) => {
          this.#values.set(
            f.name,
            stateFieldValue(schema, f, f.default, `state.${f.name}`, true),
          );
          this.#listeners.set(f.name, new Set());
          const id = `state:${f.name}`;
          this.history.register({
            id,
            label: f.name,
            read: () => this.#values.get(f.name),
            equal: (a, b) => stateJson(a) === stateJson(b),
            prepare: (raw) => {
              const value = stateFieldValue(schema, f, raw, `state.${f.name}`);
              stateJson(value);
              const listeners = [...this.#listeners.get(f.name)!];
              return {
                install: () => {
                  this.#values.set(f.name, value);
                },
                notify: () => this.publish([{ listeners, value }]),
              };
            },
          });
          return [
            f.name,
            Object.freeze({
              get: () => this.history.read(id),
              set: (v: unknown, options?: HistoryOptions) =>
                this.write(f, v, options),
              beginGesture: (options?: HistoryOptions) => {
                this.history.beginGesture(id, options);
                this.#gestures.set(f.name, this.gestureDepth(f.name) + 1);
              },
              endGesture: () => {
                this.history.endGesture(id);
                const depth = this.gestureDepth(f.name);
                if (depth > 1) this.#gestures.set(f.name, depth - 1);
                else this.#gestures.delete(f.name);
              },
              subscribe: (fn: (v: unknown) => void) => {
                if (typeof fn !== 'function')
                  throw new TypeError('subscribe expects a function');
                const listeners = this.#listeners.get(f.name)!;
                const entry = (value: unknown) => fn(value);
                listeners.add(entry);
                return () => {
                  listeners.delete(entry);
                };
              },
            }),
          ];
        }),
      ),
    );
  }
  /** Internal lifecycle inspection; gesture metadata is never part of a snapshot. */
  gestureDepth(field: string): number {
    return this.#gestures.get(field) ?? 0;
  }
  /** End unfinished interactions when the UI goes away, without changing values. */
  resetGestures(): void {
    for (const field of this.#gestures.keys())
      this.history.cancelGesture(`state:${field}`);
    this.#gestures.clear();
  }
  onRestored = (fn: () => void): (() => void) => {
    if (typeof fn !== 'function')
      throw new TypeError('onRestored expects a function');
    const entry = () => fn();
    this.#restored.add(entry);
    return () => {
      this.#restored.delete(entry);
    };
  };
  snapshot(): Record<string, unknown> {
    return Object.fromEntries(this.#values);
  }
  prepare(values: Readonly<Record<string, unknown>>): Record<string, unknown> {
    return Object.fromEntries(
      this.schema.fields.map((f) => [
        f.name,
        stateFieldValue(
          this.schema,
          f,
          Object.hasOwn(values, f.name) ? values[f.name] : f.default,
          `state.${f.name}`,
          Object.hasOwn(values, f.name),
        ),
      ]),
    );
  }
  restore(prepared: Readonly<Record<string, unknown>>): void {
    this.resetGestures();
    const changed = this.schema.fields.filter(
      (f) =>
        stateJson(this.#values.get(f.name)) !== stateJson(prepared[f.name]),
    );
    for (const f of changed) this.#values.set(f.name, prepared[f.name]);
    this.history.clear();
    this.publish([
      ...changed.map((f) => ({
        listeners: [...this.#listeners.get(f.name)!],
        value: prepared[f.name],
      })),
      { listeners: [...this.#restored], value: undefined },
    ]);
  }
  private write(
    field: StateField,
    raw: unknown,
    options?: HistoryOptions,
  ): void {
    const id = `state:${field.name}`;
    this.history.edit(
      id,
      () => {
        const value = stateFieldValue(
          this.schema,
          field,
          resolveSetter(raw, () => this.history.read(id)),
          `state.${field.name}`,
        );
        stateJson(value);
        return value;
      },
      options,
    );
  }
  private publish(
    events: {
      listeners: readonly ((value: unknown) => void)[];
      value: unknown;
    }[],
  ): void {
    this.#notifications.push(...events);
    if (this.#notifying) return;
    this.#notifying = true;
    try {
      while (this.#notifications.length > 0) {
        const event = this.#notifications.shift()!;
        for (const fn of event.listeners) {
          try {
            fn(event.value);
          } catch (error) {
            console.error(error);
          }
        }
      }
    } finally {
      this.#notifying = false;
    }
  }
}
