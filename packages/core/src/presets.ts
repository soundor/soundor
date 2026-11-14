import {
  historyLabel,
  type HistoryOptions,
  type StateHistory,
} from './history';
import { stateJson, type StateStore } from './state';

/** Portable config-resolved factory snapshot. State values use the snapshot wire representation. */
export interface FactoryPreset {
  readonly id: string;
  readonly name: string;
  readonly parameters: Readonly<Record<string, number | boolean | string>>;
  readonly state: Readonly<Record<string, unknown>>;
}
export interface PresetSelection {
  readonly factoryId: string | null;
  readonly modified: boolean;
}
export interface PresetParameter {
  readonly id: string;
  get(): unknown;
  set(value: never): void;
  subscribe(listener: () => void): () => void;
}

/** One processor/application catalog, sharing its existing field stores and history. */
export class FactoryPresets {
  readonly factory: {
    list: () => readonly { readonly id: string; readonly name: string }[];
    load: (id: string, options?: HistoryOptions) => void;
  };
  readonly #listeners = new Set<() => void>();
  readonly #off: (() => void)[] = [];
  readonly #catalog: readonly FactoryPreset[];
  #selected: string | null = null;
  #snapshot: PresetSelection = Object.freeze({
    factoryId: null,
    modified: false,
  });
  #delivered = this.#snapshot;
  constructor(
    catalog: readonly FactoryPreset[],
    readonly parameters: readonly PresetParameter[],
    readonly state: StateStore,
    readonly history: StateHistory = state.history,
  ) {
    this.#catalog = catalog.map((preset) => ({
      ...preset,
      parameters: { ...preset.parameters },
      state: state.prepare(preset.state),
    }));
    const list = Object.freeze(
      catalog.map(({ id, name }) => Object.freeze({ id, name })),
    );
    history.register({
      id: 'presets:selection',
      label: 'Preset',
      read: () => this.#selected,
      equal: Object.is,
      prepare: (value) => {
        if (
          value !== null &&
          (typeof value !== 'string' ||
            !this.#catalog.some((p) => p.id === value))
        )
          throw new TypeError('Unknown factory preset selection');
        return {
          install: () => {
            this.#selected = value as string | null;
          },
          notify: () => this.#changed(),
        };
      },
    });
    this.factory = Object.freeze({
      list: () => list,
      load: (id: string, options?: HistoryOptions) => this.#load(id, options),
    });
    for (const parameter of parameters)
      this.#off.push(parameter.subscribe(() => this.#changed()));
    for (const field of Object.values(state.fields))
      this.#off.push(field.subscribe(() => this.#changed()));
    this.#off.push(state.onRestored(() => this.restored()));
    this.restored();
  }
  #matches(preset: FactoryPreset): boolean {
    return (
      Object.entries(preset.parameters).every(
        ([id, value]) =>
          this.parameters.find((p) => p.id === id)?.get() === value,
      ) &&
      Object.entries(preset.state).every(
        ([id, value]) =>
          stateJson(this.state.fields[id]!.get()) === stateJson(value),
      )
    );
  }
  #load(id: string, options?: HistoryOptions): void {
    this.history.editGuard(() => {
      const preset = this.#catalog.find((p) => p.id === id);
      if (!preset) throw new TypeError(`Unknown factory preset '${id}'`);
      const label = historyLabel(options, `Load ${preset.name}`);
      this.history.transaction(
        label ?? `Load ${preset.name}`,
        () => {
          for (const [key, value] of Object.entries(preset.parameters)) {
            const parameter = this.parameters.find((p) => p.id === key);
            if (!parameter)
              throw new TypeError(`Unknown preset parameter '${key}'`);
            parameter.set(value as never);
          }
          for (const [key, value] of Object.entries(preset.state))
            this.state.fields[key]!.set(value);
          this.history.edit('presets:selection', () => id);
        },
        label !== null,
      );
    });
  }
  /** Called after accepted project restoration; identity is inferred from restored content. */
  restored(): void {
    this.history.edit(
      'presets:selection',
      () => this.#catalog.find((p) => this.#matches(p))?.id ?? null,
    );
    this.#changed();
  }
  getSnapshot = (): PresetSelection => {
    const id = this.history.read('presets:selection') as string | null;
    const selected = this.#catalog.find((p) => p.id === id);
    const modified = selected !== undefined && !this.#matches(selected);
    if (id !== this.#snapshot.factoryId || modified !== this.#snapshot.modified)
      this.#snapshot = Object.freeze({ factoryId: id, modified });
    return this.#snapshot;
  };
  subscribe = (listener: () => void): (() => void) => {
    if (typeof listener !== 'function')
      throw new TypeError('subscribe expects a function');
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  #changed(): void {
    const next = this.getSnapshot();
    if (
      next.factoryId === this.#delivered.factoryId &&
      next.modified === this.#delivered.modified
    )
      return;
    this.#delivered = next;
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch {
        continue;
      }
    }
  }
  dispose(): void {
    for (const off of this.#off) off();
    this.#listeners.clear();
  }
}
