import {
  StateStore,
  readSnapshot,
  stateJson,
  type SoundorSnapshot,
} from '@soundor/runtime-sdk/client';

import type { WebManifest } from './manifest';
import { publishParameter, type ParameterStore } from './parameters';
import { pluginDatabase, transaction, result, STORES } from './persistence';
import { report } from './report';

/** One standalone application: hydrate before evaluating user modules. */
export class ApplicationState {
  readonly store: StateStore;
  readonly ready: Promise<void>;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #saving = Promise.resolve();
  #hydrated = false;
  constructor(
    readonly manifest: WebManifest,
    readonly parameters: ParameterStore,
  ) {
    this.store = new StateStore(manifest.state ?? { fields: [], types: [] });
    this.ready = this.load();
    const changed = () => {
      if (this.#hydrated) this.schedule();
    };
    for (const field of Object.values(this.store.fields))
      field.subscribe(changed);
    for (const parameter of parameters.list) parameter.subscribe(changed);
  }
  snapshot(): SoundorSnapshot {
    return {
      version: 1,
      parameters: Object.fromEntries(
        this.parameters.list.map((p) => [p.id, p.get()]),
      ),
      state: this.store.snapshot(),
    };
  }
  /** Validate all values before applying any of them. */
  restore(snapshot: SoundorSnapshot): void {
    const state = this.store.prepare(snapshot.state);
    const parameters = this.parameters.list.map((p) => {
      const value = Object.hasOwn(snapshot.parameters, p.id)
        ? snapshot.parameters[p.id]
        : p.info.default;
      const info = p.info;
      const valid =
        info.type === 'boolean'
          ? typeof value === 'boolean'
          : info.type === 'choice'
            ? info.options.some((o) => o.value === value)
            : typeof value === 'number' &&
              Number.isFinite(value) &&
              value >= info.min &&
              value <= info.max &&
              (info.type === 'float32' || Number.isInteger(value));
      if (!valid)
        throw new TypeError(`parameters.${p.id}: invalid snapshot value`);
      return value;
    });
    parameters.forEach((value, index) =>
      publishParameter(this.parameters.list[index]!, value as never),
    );
    this.store.restore(state);
  }
  reset(): void {
    this.restore({ version: 1, parameters: {}, state: {} });
    this.schedule();
  }
  private async load(): Promise<void> {
    try {
      const text: unknown = await transaction(
        pluginDatabase(this.manifest.plugin.id),
        STORES.storage,
        'readonly',
        (s) => result(s.get('soundor:snapshot:v1')),
      );
      if (text !== undefined) {
        if (typeof text !== 'string')
          throw new TypeError('Invalid Soundor snapshot');
        this.restore(readSnapshot(text));
      }
    } catch (error) {
      report(error);
    } finally {
      this.#hydrated = true;
    }
  }
  private schedule(): void {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      void this.flush();
    }, 100);
  }
  /** Flush pending changes. Storage failure leaves live application values intact. */
  async flush(): Promise<void> {
    clearTimeout(this.#timer);
    let text: string;
    try {
      text = stateJson(this.snapshot());
    } catch (error) {
      report(error);
      return;
    }
    this.#saving = this.#saving.then(async () => {
      try {
        await transaction(
          pluginDatabase(this.manifest.plugin.id),
          STORES.storage,
          'readwrite',
          (s) => result(s.put(text, 'soundor:snapshot:v1')),
        );
      } catch (error) {
        report(error);
      }
    });
    await this.#saving;
  }
}
