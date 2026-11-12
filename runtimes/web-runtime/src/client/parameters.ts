/**
 * The Web host's parameter store: one {@link WebParameter} per declared
 * parameter, shared by the plugin UI (`soundor:parameters`), the user's Web
 * Audio code and the host's own UI. There is no second copy to keep in sync.
 *
 * Values are in plain units, as in the JUCE runtime: numbers within
 * [min, max] on the step's grid (float32 values are 32-bit floats), booleans,
 * or one of a choice's option values. Their mapping, step and text are the
 * generated behavior (`parameters.js`), compiled from the same expressions as
 * the JUCE runtime's C++; the API and its errors are the JUCE runtime's.
 */

import {
  StateHistory,
  type HistoryOptions,
  resolveSetter,
  type ValueOrUpdater,
} from '@soundor/runtime-sdk/client';

import { Listeners } from './listeners';
import type { WebParameterInfo } from './manifest';

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
export type ParameterValue<Info extends WebParameterInfo> = Info extends {
  type: 'boolean';
}
  ? boolean
  : Info extends { type: 'choice' }
    ? string
    : number;

/** The processing's write to a read-only parameter (see {@link publishParameter}). */
const publishers = new WeakMap<WebParameter, (value: unknown) => void>();

/** One parameter: what `soundor:parameters` hands the plugin. */
export class WebParameter<Info extends WebParameterInfo = WebParameterInfo> {
  readonly #info: Info;
  readonly #behavior: ParameterBehavior;
  /** The plain value: a boolean's 0 or 1, a choice's index. */
  #plain: number;
  #gestures = 0;
  readonly #listeners = new Listeners<ParameterValue<Info>>();

  constructor(
    info: Info,
    behavior: ParameterBehavior,
    readonly history = new StateHistory(),
  ) {
    this.#info = freezeInfo(info);
    this.#behavior = behavior;
    this.#plain = behavior.constrain(this.#toPlain(info.default));
    publishers.set(this as WebParameter, (value) =>
      this.#store(this.#toPlain(value)),
    );
    this.history.register({
      id: `parameter:${info.id}`,
      label: info.label,
      read: () => this.#plain,
      equal: Object.is,
      prepare: (value) => {
        if (typeof value !== 'number' || !Number.isFinite(value))
          throw new TypeError('Invalid History parameter value');
        const next = this.#behavior.constrain(value);
        return {
          install: () => {
            this.#plain = next;
          },
          notify: () => {
            const automatic =
              this.#info.access === 'automatable' && !this.inGesture;
            if (automatic) this.#gestures++;
            try {
              this.#listeners.notify(this.#fromPlain(next));
            } finally {
              if (automatic) this.#gestures--;
            }
          },
        };
      },
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
    return this.#fromPlain(this.history.read(`parameter:${this.id}`) as number);
  }

  /**
   * Sets the value, snapped to the range and step; a value of the wrong
   * type, or any value of a read-only parameter, is a TypeError. Listeners
   * hear of changes only.
   */
  set(
    value: ValueOrUpdater<ParameterValue<Info>>,
    options?: HistoryOptions,
  ): void {
    this.history.edit(
      `parameter:${this.id}`,
      () => {
        this.#writable();
        return this.#behavior.constrain(
          this.#toPlain(resolveSetter(value, () => this.get())),
        );
      },
      options,
    );
  }

  /**
   * Calls `listener` with the new value after every change, whatever made it.
   * Returns a function that unsubscribes.
   */
  subscribe(listener: (value: ParameterValue<Info>) => void): () => void {
    return this.#listeners.add(
      listener,
      `Parameter '${this.#info.id}': subscribe()`,
    );
  }

  /** Starts a user interaction (a drag, say). Interactions may nest. */
  beginGesture(options?: HistoryOptions): void {
    this.history.editGuard(() => this.#writable());
    this.history.beginGesture(`parameter:${this.id}`, options);
    this.#gestures++;
  }

  /** Ends the interaction started with beginGesture(); extra calls do nothing. */
  endGesture(): void {
    this.history.endGesture(`parameter:${this.id}`);
    if (this.#gestures > 0) this.#gestures--;
  }

  /** Whether a user interaction is in progress. */
  get inGesture(): boolean {
    return this.#gestures > 0;
  }

  /** The value (the current one by default) as hosts show it. */
  format(...value: [] | [ParameterValue<Info>]): string {
    const plain =
      value.length === 0
        ? (this.history.read(`parameter:${this.id}`) as number)
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
        ? (this.history.read(`parameter:${this.id}`) as number)
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
    const info = this.#info as WebParameterInfo;
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
    const info = this.#info as WebParameterInfo;
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
 * Sets a parameter as the plugin's processing does, read-only ones included:
 * for the project's audio code, through its setup context's `publish`.
 */
export function publishParameter<Info extends WebParameterInfo>(
  parameter: WebParameter<Info>,
  value: ParameterValue<Info>,
): void {
  const publish = publishers.get(parameter as WebParameter);
  if (publish === undefined)
    throw new TypeError('publish() takes a parameter of this plugin');
  publish(value);
}

/** Every parameter of a plugin, by id and in declaration order. */
export interface ParameterStore {
  readonly history: StateHistory;
  readonly list: readonly WebParameter[];
  readonly byId: Readonly<Record<string, WebParameter>>;
}

/** Creates the store for a plugin's declared parameters and their behavior. */
export function createParameterStore(
  infos: readonly WebParameterInfo[],
  behaviors: readonly ParameterBehavior[],
  history = new StateHistory(),
): ParameterStore {
  if (behaviors.length !== infos.length)
    throw new Error(
      `The parameters' behavior (${behaviors.length}) does not match the manifest (${infos.length}); run soundor gen`,
    );
  const list = Object.freeze(
    infos.map(
      (info, index) => new WebParameter(info, behaviors[index]!, history),
    ),
  );
  return {
    history,
    list,
    byId: Object.freeze(
      Object.fromEntries(list.map((parameter) => [parameter.id, parameter])),
    ),
  };
}

function freezeInfo<Info extends WebParameterInfo>(info: Info): Info {
  const copy = { ...info } as WebParameterInfo;
  if (copy.type === 'choice')
    (copy as { options: unknown }).options = Object.freeze(
      copy.options.map((option) => Object.freeze({ ...option })),
    );
  return Object.freeze(copy) as Info;
}

function describe(value: unknown): string {
  return typeof value === 'string' ? `'${value}'` : String(value);
}
