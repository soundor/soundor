import { describe, expect, it, vi } from 'vitest';

import corpus from '../test-data/state-snapshots.json';
import { describeState, StateStore, readSnapshot, stateJson } from './state';
import { renderStateDts } from './state-dts';

const native = {
  types: {
    Band: {
      struct: { frequency: 'float32', gain: 'float64', label: 'string?' },
    },
    Group: { struct: { bands: 'Band[]', index: 'uint64' } },
  },
};
const declaration = {
  selected: { type: 'string?', default: null },
  groups: {
    type: 'Group[]',
    default: [
      {
        bands: [{ frequency: 1000, gain: -3.125, label: null }],
        index: 18446744073709551615n,
      },
    ],
  },
  enabled: { type: 'boolean', default: true },
};
const schema = describeState(declaration, native);
describe('persistent state', () => {
  it('validates nested defaults and supplies detached immutable instance values', () => {
    const a = new StateStore(schema),
      b = new StateStore(schema);
    expect(a.fields.groups!.get()).toEqual(declaration.groups.default);
    expect(a.fields.groups!.get()).not.toBe(b.fields.groups!.get());
    expect(a.fields.groups!.get()).toBe(a.fields.groups!.get());
    expect(() => (a.fields.groups!.get() as unknown[]).push(null)).toThrow();
    a.fields.selected!.set('Warm');
    expect(b.fields.selected!.get()).toBeNull();
  });
  it('copies writes, notifies changes only, and unsubscribes', () => {
    const store = new StateStore(schema),
      listener = vi.fn();
    const off = store.fields.groups!.subscribe(listener);
    const next = structuredClone(declaration.groups.default);
    store.fields.groups!.set(next);
    expect(listener).not.toHaveBeenCalled();
    next[0]!.bands[0]!.gain = 7;
    store.fields.groups!.set(next);
    next[0]!.bands[0]!.gain = 10;
    expect((store.fields.groups!.get() as typeof next)[0]!.bands[0]!.gain).toBe(
      7,
    );
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    store.fields.groups!.set([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it('roundtrips the wire format without losing int64 precision or null', () => {
    const a = new StateStore(schema),
      b = new StateStore(schema);
    const text = stateJson({ version: 1, parameters: {}, state: a.snapshot() });
    const snapshot = readSnapshot(text);
    b.restore(b.prepare(snapshot.state));
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(text).toContain('18446744073709551615');
  });
  it('prepares the complete restoration before mutation, defaults missing and ignores removed fields', () => {
    const store = new StateStore(schema);
    store.fields.selected!.set('Before');
    expect(() =>
      store.prepare({
        selected: 'After',
        groups: [{ bands: [], index: '18446744073709551616' }],
      }),
    ).toThrow(/index/);
    expect(store.fields.selected!.get()).toBe('Before');
    const calls: string[] = [];
    store.fields.selected!.subscribe(() => {
      calls.push('field');
      expect(store.fields.enabled!.get()).toBe(false);
    });
    store.onRestored(() => {
      calls.push('restored');
      expect(store.fields.selected!.get()).toBeNull();
    });
    store.restore(store.prepare({ removed: 42, enabled: false }));
    expect(calls).toEqual(['field', 'restored']);
  });
  it.each([
    { x: { type: 'string' } },
    { x: { type: 'boolean', default: 'true' } },
    { x: { type: 'uint8', default: 256 } },
    { x: { type: 'int32', default: 1.5 } },
    { x: { type: 'float32', default: 1e100 } },
    { x: { type: 'float64', default: NaN } },
    { x: { type: 'string?', default: undefined } },
    { x: { type: 'Missing', default: {} } },
    { x: { type: 'Band[]', default: [{ frequency: 'oops' }] } },
  ])('rejects invalid declarations: %j', (value) => {
    expect(() => describeState(value as never, native)).toThrow();
  });
  it('rejects invalid writes and unsupported snapshots', () => {
    const store = new StateStore(schema);
    expect(() => store.fields.selected!.set(undefined)).toThrow(/selected/);
    expect(() => store.fields.groups!.set([{ bands: [], index: -1n }])).toThrow(
      /index/,
    );
    for (const text of [
      '{}',
      '{',
      '{"version":2,"parameters":{},"state":{}}',
      '{"version":1,"parameters":{},"state":null}',
    ])
      expect(() => readSnapshot(text)).toThrow();
  });
  it('generates field types from the native registry', () => {
    const output = renderStateDts(declaration, native);
    expect(output).toContain('readonly selected: StateField<string | null>');
    expect(output).toContain('readonly groups: StateField<Group[]>');
    expect(output).toContain('index: bigint');
  });
});

it('uses the JUCE logical snapshot corpus', () => {
  const schema = describeState(
    {
      selectedPreset: { type: 'string?', default: null },
      enabled: { type: 'boolean', default: true },
      groups: declaration.groups,
      signedValue: { type: 'int64', default: -9223372036854775808n },
      unsignedValue: { type: 'uint64', default: 18446744073709551615n },
      precise: { type: 'float64', default: 0.000012345678901234567 },
    },
    native,
  );
  for (const item of corpus) {
    const store = new StateStore(schema);
    const restore = () => {
      const snapshot = readSnapshot(stateJson(item.snapshot));
      store.restore(store.prepare(snapshot.state));
    };
    if (item.valid) {
      restore();
      expect(store.fields.unsignedValue!.get()).toBe(18446744073709551615n);
    } else expect(restore).toThrow();
  }
});

it('preserves reentrant write ordering and independent repeated subscriptions', () => {
  const store = new StateStore(
    describeState({ count: { type: 'int32', default: 0 } }),
  );
  const seen: unknown[] = [];
  store.fields.count!.subscribe((v) => {
    if (v === 1) store.fields.count!.set(2);
  });
  const listener = (v: unknown) => seen.push(v);
  const off = store.fields.count!.subscribe(listener);
  store.fields.count!.subscribe(listener);
  store.fields.count!.set(1);
  expect(seen).toEqual([1, 1, 2, 2]);
  off();
  store.fields.count!.set(3);
  expect(seen).toEqual([1, 1, 2, 2, 3]);
});
