/**
 * The simulated runtime's parameter store: one {@link TestParameter} per
 * declared parameter, as the Web runtime has them. Values are in plain units,
 * as in the JUCE runtime; their mapping, step and text are the expressions
 * `@soundor/config` resolved, compiled to JavaScript as the Web runtime's are,
 * so a test sees what a plugin does.
 */

import { resolveSetter, type ValueOrUpdater } from '@soundor/core';
import { compileJsFunction } from '@soundor/expression/compiler/js';

import { Listeners } from './listeners';
import type {
  ParameterInfo as TestParameterInfo,
  ParameterInit,
} from './services';

/**
 * What a parameter does, generated from soundor.config. Values are plain
 * numbers: a boolean's 0 or 1, a choice's option index.
 */
export interface ParameterBehavior {
  /** Normalized position (clamped to [0, 1]) → a legal value. */
  toValue(normalized: number): number;
  /** A legal value → its normalized position. */
  toNormalized(value: number): number;
  /** Any finite value → the nearest legal value. */
  constrain(value: number): number;
  /** A legal value → display text. */
  format(value: number): string;
  /** Text → a legal value, or null. */
  parse(text: string): number | null;
}

/** A parameter's JavaScript value type, by its declared type. */
export type ParameterValue<Info extends TestParameterInfo> = Info extends {
  type: 'boolean';
}
  ? boolean
  : Info extends { type: 'choice' }
    ? string
    : number;

/** What the host and the processing write, read-only parameters included (see {@link setParameterAsHost}). */
const hostWriters = new WeakMap<TestParameter, (value: unknown) => void>();

/** One parameter: what `soundor:parameters` hands the plugin. */
export class TestParameter<Info extends TestParameterInfo = TestParameterInfo> {
  readonly #info: Info;
  readonly #behavior: ParameterBehavior;
  /** The plain value: a boolean's 0 or 1, a choice's index. */
  #plain: number;
  #gestures = 0;
  #disposed = false;
  readonly #listeners = new Listeners<ParameterValue<Info>>();

  constructor(info: Info, behavior: ParameterBehavior) {
    this.#info = freezeInfo(info);
    this.#behavior = behavior;
    this.#plain = behavior.constrain(this.#toPlain(info.default));
    hostWriters.set(this as TestParameter, (value) => {
      this.#active();
      this.#store(this.#toPlain(value));
    });
    Object.freeze(this);
  }

  get id(): Info['id'] {
    return this.#info.id;
  }

  /** The declaration, frozen. */
  get info(): Info {
    return this.#info;
  }

  /** The current value. */
  get(): ParameterValue<Info> {
    this.#active();
    return this.#fromPlain(this.#plain);
  }

  /**
   * Sets the value, snapped to the range and step; a value of the wrong
   * type, or any value of a read-only parameter, is a TypeError. Listeners
   * hear of changes only.
   */
  set(value: ValueOrUpdater<ParameterValue<Info>>): void {
    this.#active();
    this.#writable();
    this.#store(this.#toPlain(resolveSetter(value, () => this.get())), true);
  }

  /**
   * Calls `listener` with the new value after every change, whatever made it.
   * Returns a function that unsubscribes.
   */
  subscribe(listener: (value: ParameterValue<Info>) => void): () => void {
    this.#active();
    return this.#listeners.add(
      listener,
      `Parameter '${this.#info.id}': subscribe()`,
    );
  }

  /** Starts a user interaction (a drag, say). Interactions may nest. */
  beginGesture(): void {
    this.#active();
    this.#writable();
    this.#gestures++;
  }

  /** Ends the interaction started with beginGesture(); extra calls do nothing. */
  endGesture(): void {
    this.#active();
    if (this.#gestures > 0) this.#gestures--;
  }

  /** Whether a user interaction is in progress. */
  get inGesture(): boolean {
    return this.#gestures > 0;
  }

  dispose(): void {
    this.#disposed = true;
    this.#listeners.clear();
    this.#gestures = 0;
  }

  #active(): void {
    if (this.#disposed)
      throw new Error('Soundor test parameter has been disposed');
  }

  /** The value (the current one by default) as hosts show it. */
  format(...value: [] | [ParameterValue<Info>]): string {
    const plain =
      value.length === 0
        ? this.#plain
        : this.#behavior.constrain(this.#toPlain(value[0]));
    return this.#behavior.format(plain);
  }

  /** Text read as a value, or null when it is not one. */
  parse(text: string): ParameterValue<Info> | null {
    if (typeof text !== 'string') {
      throw new TypeError(
        `Parameter '${this.#info.id}': parse() expects a string, got ${describe(text)}`,
      );
    }
    const plain = this.#behavior.parse(text);
    return plain === null ? null : this.#fromPlain(plain);
  }

  /** The value's (the current one's by default) position in [0, 1]. */
  toNormalized(...value: [] | [ParameterValue<Info>]): number {
    const plain =
      value.length === 0
        ? this.#plain
        : this.#behavior.constrain(this.#toPlain(value[0]));
    return this.#behavior.toNormalized(plain);
  }

  /** The value at a position in [0, 1] (clamped), mapped and snapped. */
  fromNormalized(normalized: number): ParameterValue<Info> {
    if (typeof normalized !== 'number' || Number.isNaN(normalized)) {
      throw new TypeError(
        `Parameter '${this.#info.id}': fromNormalized() expects a number, got ${describe(normalized)}`,
      );
    }
    return this.#fromPlain(this.#behavior.toValue(normalized));
  }

  #store(plain: number, userEdit = false): void {
    const next = this.#behavior.constrain(plain);
    if (Object.is(next, this.#plain)) return;
    const automatic =
      userEdit && this.#info.access === 'automatable' && !this.inGesture;
    if (automatic) this.beginGesture();
    try {
      this.#plain = next;
      this.#listeners.notify(this.#fromPlain(next));
    } finally {
      if (automatic) this.endGesture();
    }
  }

  #writable(): void {
    if (this.#info.access === 'readOnly') {
      throw new TypeError(
        `Parameter '${this.#info.id}' is read-only: only the plugin's processing sets it`,
      );
    }
  }

  #fromPlain(plain: number): ParameterValue<Info> {
    const info = this.#info as TestParameterInfo;
    switch (info.type) {
      case 'boolean':
        return (plain >= 0.5) as ParameterValue<Info>;
      case 'choice':
        return info.options[Math.round(plain)]!.value as ParameterValue<Info>;
      default:
        return plain as ParameterValue<Info>;
    }
  }

  #toPlain(value: unknown): number {
    const info = this.#info as TestParameterInfo;
    switch (info.type) {
      case 'boolean':
        if (typeof value !== 'boolean') {
          throw new TypeError(
            `Parameter '${info.id}' expects a boolean, got ${describe(value)}`,
          );
        }
        return value ? 1 : 0;
      case 'choice': {
        const index = info.options.findIndex(
          (option) => option.value === value,
        );
        if (index < 0) {
          throw new TypeError(
            `Parameter '${info.id}' expects one of ${info.options.map((option) => `'${option.value}'`).join(', ')}, got ${describe(value)}`,
          );
        }
        return index;
      }
      default:
        if (typeof value !== 'number' || Number.isNaN(value)) {
          throw new TypeError(
            `Parameter '${info.id}' expects a number, got ${describe(value)}`,
          );
        }
        return value;
    }
  }
}

/**
 * Sets a parameter as the host or the plugin's processing does, read-only
 * ones included: what Testing Library's `testParameters.set` simulates.
 */
export function setParameterAsHost<Info extends TestParameterInfo>(
  parameter: TestParameter<Info>,
  value: ParameterValue<Info>,
): void {
  const write = hostWriters.get(parameter as TestParameter);
  if (write === undefined)
    throw new TypeError(
      'setParameterAsHost() takes a parameter of the test runtime',
    );
  write(value);
}

/** Compiles a resolved parameter's expressions, as the Web runtime's gen does. */
export function compileBehavior(
  semantics: ParameterInit['semantics'],
): ParameterBehavior {
  const valueType = semantics.valueType as never;
  const fn = (expression: unknown, inputs: Record<string, string>) =>
    compileJsFunction(expression, inputs as never) as never;
  return {
    toValue: fn(semantics.toValue, { normalized: 'float64' }),
    toNormalized: fn(semantics.toNormalized, { value: valueType }),
    constrain: fn(semantics.constrain, { value: 'float64' }),
    format: fn(semantics.format, { value: valueType }),
    parse: fn(semantics.parse, { text: 'string' }),
  };
}

/** Every parameter of a plugin, by id and in declaration order. */
export interface ParameterStore {
  readonly list: readonly TestParameter[];
  readonly byId: Readonly<Record<string, TestParameter>>;
}

/** Creates the store for a plugin's resolved parameters. */
export function createParameterStore(
  parameters: readonly ParameterInit[],
): ParameterStore {
  const list = Object.freeze(
    parameters.map(({ semantics, mapping: _mapping, ...info }) => {
      if (semantics === undefined)
        throw new TypeError(
          `Parameter '${info.id}' has no resolved behavior: pass resolveConfig(...).parameters from @soundor/config`,
        );
      return new TestParameter(
        info as TestParameterInfo,
        compileBehavior(semantics),
      );
    }),
  );
  return {
    list,
    byId: Object.freeze(
      Object.fromEntries(list.map((parameter) => [parameter.id, parameter])),
    ),
  };
}

function freezeInfo<Info extends TestParameterInfo>(info: Info): Info {
  const copy = { ...info } as TestParameterInfo;
  if (copy.type === 'choice')
    (copy as { options: unknown }).options = Object.freeze(
      copy.options.map((option) => Object.freeze({ ...option })),
    );
  return Object.freeze(copy) as Info;
}

function describe(value: unknown): string {
  return typeof value === 'string' ? `'${value}'` : String(value);
}
