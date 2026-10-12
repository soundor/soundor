/**
 * The Web host's parameter store: one {@link TestParameter} per declared
 * parameter, shared by the plugin UI (`soundor:parameters`), the user's Web
 * Audio code and the host's own UI. There is no second copy to keep in sync.
 *
 * Values are in plain units, as in the JUCE runtime: numbers within
 * [min, max] (ints rounded), booleans, or one of an enum's values.
 */

import { Listeners } from './listeners';
import type { ParameterInfo as TestParameterInfo } from './services';

/** A parameter's JavaScript value type, by its declared type. */
export type ParameterValue<Info extends TestParameterInfo> = Info extends {
  type: 'bool';
}
  ? boolean
  : Info extends { type: 'enum' }
    ? string
    : number;

/** One parameter: what `soundor:parameters` hands the plugin. */
export class TestParameter<Info extends TestParameterInfo = TestParameterInfo> {
  readonly #info: Info;
  #value: ParameterValue<Info>;
  #gestures = 0;
  #disposed = false;
  #active() {
    if (this.#disposed)
      throw new Error('Soundor test parameter has been disposed');
  }
  readonly #listeners = new Listeners<ParameterValue<Info>>();

  constructor(info: Info) {
    this.#info = Object.freeze({
      ...info,
      ...(info.type === 'enum'
        ? { values: Object.freeze([...info.values]) }
        : {}),
    }) as Info;
    this.#value = this.#coerce(info.default as ParameterValue<Info>);
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
    return this.#value;
  }

  /**
   * Sets the value: numbers are clamped to the range (ints rounded), and a
   * value of the wrong type is a TypeError. Listeners hear of changes only.
   */
  set(value: ParameterValue<Info>): void {
    this.#active();
    const next = this.#coerce(value);
    if (Object.is(next, this.#value)) return;
    this.#value = next;
    this.#listeners.notify(next);
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

  #coerce(value: unknown): ParameterValue<Info> {
    const info = this.#info;
    switch (info.type) {
      case 'float':
      case 'int': {
        if (typeof value !== 'number' || Number.isNaN(value)) {
          throw new TypeError(
            `Parameter '${info.id}' expects a number, got ${describe(value)}`,
          );
        }
        const clamped = Math.min(info.max, Math.max(info.min, value));
        return (
          info.type === 'int' ? Math.round(clamped) : clamped
        ) as ParameterValue<Info>;
      }
      case 'bool':
        if (typeof value !== 'boolean') {
          throw new TypeError(
            `Parameter '${info.id}' expects a boolean, got ${describe(value)}`,
          );
        }
        return value as ParameterValue<Info>;
      case 'enum':
        if (typeof value !== 'string' || !info.values.includes(value)) {
          throw new TypeError(
            `Parameter '${info.id}' expects one of ${info.values.map((v) => `'${v}'`).join(', ')}, got ${describe(value)}`,
          );
        }
        return value as ParameterValue<Info>;
    }
  }
}

/** Every parameter of a plugin, by id and in declaration order. */
export interface ParameterStore {
  readonly list: readonly TestParameter[];
  readonly byId: Readonly<Record<string, TestParameter>>;
}

/** Creates the store for a plugin's declared parameters. */
export function createParameterStore(
  infos: readonly TestParameterInfo[],
): ParameterStore {
  const list = Object.freeze(infos.map((info) => new TestParameter(info)));
  return {
    list,
    byId: Object.freeze(
      Object.fromEntries(list.map((parameter) => [parameter.id, parameter])),
    ),
  };
}

function describe(value: unknown): string {
  return typeof value === 'string' ? `'${value}'` : String(value);
}
