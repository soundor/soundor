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
}
export type StateDeclarations = Readonly<Record<string, StateDeclaration>>;
export interface StateField {
  readonly name: string;
  readonly type: NativeType;
  readonly default: unknown;
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
  };
};
export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
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
    if (Object.keys(field).some((k) => k !== 'type' && k !== 'default'))
      throw new TypeError(`state.${name}: unknown declaration property`);
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
    fields: result.model.methods[0]!.args.map((f) => ({
      ...f,
      default: declaration[f.name]!.default,
    })),
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
  return {
    ...schema,
    types: schema.types.filter((t) => used.has(t.name)),
    fields: schema.fields.map((f) => ({
      ...f,
      default: stateValue(schema, f.type, f.default, `state.${f.name}.default`),
    })),
  };
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
  set(value: ValueOrUpdater<T>): void;
  beginGesture(): void;
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
  constructor(readonly schema: StateSchema) {
    this.fields = Object.freeze(
      Object.fromEntries(
        schema.fields.map((f) => {
          this.#values.set(
            f.name,
            stateValue(schema, f.type, f.default, `state.${f.name}`, true),
          );
          this.#listeners.set(f.name, new Set());
          return [
            f.name,
            Object.freeze({
              get: () => this.#values.get(f.name),
              set: (v: unknown) => this.write(f, v),
              beginGesture: () => {
                this.#gestures.set(f.name, this.gestureDepth(f.name) + 1);
              },
              endGesture: () => {
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
        stateValue(
          this.schema,
          f.type,
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
    this.publish([
      ...changed.map((f) => ({
        listeners: [...this.#listeners.get(f.name)!],
        value: prepared[f.name],
      })),
      { listeners: [...this.#restored], value: undefined },
    ]);
  }
  private write(field: StateField, raw: unknown): void {
    const value = stateValue(
      this.schema,
      field.type,
      resolveSetter(raw, () => this.#values.get(field.name)),
      `state.${field.name}`,
    );
    if (stateJson(value) === stateJson(this.#values.get(field.name))) return;
    this.#values.set(field.name, value);
    this.publish([{ listeners: [...this.#listeners.get(field.name)!], value }]);
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
