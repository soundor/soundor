// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import {
  describeState,
  readSnapshot,
  stateJson,
} from '@soundor/runtime-sdk/client';
import { behaviors } from 'soundor:internal/parameters';
import { describe, expect, it, vi } from 'vitest';

import type { WebManifest } from './manifest';
import { createParameterStore } from './parameters';
import { pluginDatabase, transaction, result, STORES } from './persistence';
import { ApplicationState } from './state';
import fixture from './testing/manifest.json';

let counter = 0;
function application(id = `dev.soundor.state-${++counter}`) {
  const schema = describeState(
    {
      selected: { type: 'string?', default: null },
      bands: { type: 'Band[]', default: [] },
    },
    { types: { Band: { struct: { gain: 'float64' } } } },
  );
  const manifest: WebManifest = {
    ...fixture,
    plugin: { id, name: 'State' },
    state: schema,
  } as WebManifest;
  const parameters = createParameterStore(manifest.parameters, behaviors);
  return new ApplicationState(manifest, parameters);
}
describe('standalone persistence', () => {
  it('loads defaults, saves parameters and state, and hydrates a restarted application', async () => {
    const a = application();
    await a.ready;
    expect(a.store.fields.selected!.get()).toBeNull();
    a.store.fields.selected!.set('Warm');
    a.store.fields.bands!.set([{ gain: -3.125 }]);
    a.parameters.byId.gain!.set(0.75);
    await a.flush();
    const b = application(a.manifest.plugin.id);
    const restored = vi.fn();
    b.store.onRestored(restored);
    await b.ready;
    expect(b.store.fields.selected!.get()).toBe('Warm');
    expect(b.store.fields.bands!.get()).toEqual([{ gain: -3.125 }]);
    expect(b.parameters.byId.gain!.get()).toBe(0.75);
    expect(restored).toHaveBeenCalledTimes(1);
    const c = application();
    await c.ready;
    expect(c.store.fields.selected!.get()).toBeNull();
    expect(c.parameters.byId.gain!.get()).not.toBe(0.75);
    b.reset();
    await b.flush();
    const d = application(a.manifest.plugin.id);
    await d.ready;
    expect(d.store.fields.selected!.get()).toBeNull();
    expect(d.parameters.byId.gain!.get()).toBe(
      d.parameters.byId.gain!.info.default,
    );
  });
  it('rejects a whole invalid persisted snapshot and keeps live values on storage failure', async () => {
    const a = application();
    await a.ready;
    const data = {
      ...a.snapshot(),
      state: { selected: 'Should not apply', bands: [{ gain: 'bad' }] },
    };
    await transaction(
      pluginDatabase(a.manifest.plugin.id),
      STORES.storage,
      'readwrite',
      (s) => result(s.put(stateJson(data), 'soundor:snapshot:v1')),
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const b = application(a.manifest.plugin.id);
    await b.ready;
    expect(b.store.fields.selected!.get()).toBeNull();
    expect(log).toHaveBeenCalled();
    b.store.fields.selected!.set('Keep');
    const database = await pluginDatabase(b.manifest.plugin.id);
    const failing = vi.spyOn(database, 'transaction').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    await b.flush();
    expect(b.store.fields.selected!.get()).toBe('Keep');
    failing.mockRestore();
    log.mockRestore();
  });
  it('validates all parameters before applying state and orders field notifications before restored', async () => {
    const a = application();
    await a.ready;
    expect(() =>
      a.restore(
        readSnapshot(
          stateJson({
            ...a.snapshot(),
            parameters: { gain: 999 },
            state: { selected: 'bad' },
          }),
        ),
      ),
    ).toThrow();
    expect(a.store.fields.selected!.get()).toBeNull();
    const seen: string[] = [];
    a.store.fields.selected!.subscribe(() => {
      seen.push('field');
      expect(a.parameters.byId.gain!.get()).toBe(0.75);
    });
    a.store.onRestored(() => seen.push('restored'));
    a.restore(
      readSnapshot(
        stateJson({
          ...a.snapshot(),
          parameters: { gain: 0.75 },
          state: { selected: 'Good' },
        }),
      ),
    );
    expect(seen).toEqual(['field', 'restored']);
    await a.flush();
  });
});
