import { resolveConfig } from '@soundor/config';
import { describeState, stateJson } from '@soundor/core';
import { expect, it, vi } from 'vitest';

import { setParameterAsHost } from './parameters';
import { createTestRuntime } from './runtime';

function fixture() {
  const config = resolveConfig({
    plugin: { id: 'test.presets', name: 'Presets' },
    runtimes: [],
    parameters: {
      gain: { type: 'float32', min: 0, max: 1, default: 0.5 },
      mode: {
        type: 'choice',
        options: [
          { value: 'clean', label: 'Clean' },
          { value: 'warm', label: 'Warm' },
        ],
        default: 'clean',
      },
      meter: {
        type: 'float32',
        min: 0,
        max: 1,
        default: 0,
        access: 'readOnly',
      },
    },
    state: {
      title: { type: 'string', default: 'Init' },
      large: { type: 'uint64', default: 18446744073709551615n },
    },
    presets: [
      { id: 'init', name: 'Init' },
      {
        id: 'warm',
        name: 'Warm',
        parameters: { gain: 0.75, mode: 'warm' },
        state: { title: 'Warm' },
      },
    ],
  });
  return createTestRuntime({
    parameters: config.parameters,
    state: describeState(config.state),
    presets: JSON.parse(stateJson(config.presets)),
  });
}
it('loads one coherent snapshot with opt-in undo and redo, including selection', () => {
  const r = fixture();
  const gain = r.parameters.byId.gain!;
  expect(r.presets.getSnapshot()).toEqual({
    factoryId: 'init',
    modified: false,
  });
  const listener = vi.fn<() => void>(() =>
    expect(r.state.fields.title!.get()).toBe('Warm'),
  );
  const off = gain.subscribe(listener);
  r.presets.factory.load('warm', { history: true });
  off();
  expect(listener).toHaveBeenCalledOnce();
  expect(gain.get()).toBe(0.75);
  expect(r.state.fields.large!.get()).toBe(18446744073709551615n);
  expect(r.history.undoLabel()).toBe('Load Warm');
  r.history.undo();
  expect(gain.get()).toBe(0.5);
  expect(r.state.fields.title!.get()).toBe('Init');
  expect(r.presets.getSnapshot()).toEqual({
    factoryId: 'init',
    modified: false,
  });
  r.history.redo();
  expect(r.presets.getSnapshot()).toEqual({
    factoryId: 'warm',
    modified: false,
  });
  r.dispose();
});
it('composes synchronous loads in an outer transaction and rolls back failed loads', () => {
  const r = fixture();
  r.history.transaction('Load and adjust', () => {
    r.presets.factory.load('warm');
    r.parameters.byId.gain!.set(0.9);
  });
  expect(r.history.undoLabel()).toBe('Load and adjust');
  expect(r.presets.getSnapshot()).toEqual({
    factoryId: 'warm',
    modified: true,
  });
  r.history.undo();
  expect(r.presets.getSnapshot().factoryId).toBe('init');
  expect(() =>
    r.history.transaction('Failed', () => {
      r.presets.factory.load('warm');
      r.presets.factory.load('missing');
    }),
  ).toThrow("Unknown factory preset 'missing'");
  expect(r.parameters.byId.gain!.get()).toBe(0.5);
  expect(r.history.canRedo()).toBe(true);
  r.dispose();
});
it('does not record by default, observes host edits and ignores read-only outputs', () => {
  const r = fixture();
  const callback = vi.fn<() => void>();
  const off = r.presets.subscribe(callback);
  r.presets.factory.load('warm');
  expect(r.history.canUndo()).toBe(false);
  expect(r.presets.getSnapshot()).toBe(r.presets.getSnapshot());
  setParameterAsHost(r.parameters.byId.meter!, 0.8);
  expect(r.presets.getSnapshot().modified).toBe(false);
  setParameterAsHost(r.parameters.byId.gain!, 0.2);
  expect(r.presets.getSnapshot().modified).toBe(true);
  expect(callback).toHaveBeenCalledTimes(2);
  off();
  r.dispose();
});
it('matches factory content on restoration and treats unknown content as custom', () => {
  const r = fixture();
  r.presets.factory.load('warm', { history: true });
  r.state.restore(r.state.prepare({ title: 'Other' }));
  expect(r.history.canUndo()).toBe(false);
  expect(r.presets.getSnapshot()).toEqual({ factoryId: null, modified: false });
  r.dispose();
});
it('rejects loading over an active History gesture without partial application', () => {
  const r = fixture();
  r.parameters.byId.gain!.beginGesture({ history: true });
  expect(() => r.presets.factory.load('warm', { history: true })).toThrow(
    'History gesture',
  );
  expect(r.state.fields.title!.get()).toBe('Init');
  r.parameters.byId.gain!.endGesture();
  r.dispose();
});

it('notifies subscribers when a staged snapshot was read before commit', () => {
  const r = fixture();
  const listener = vi.fn<() => void>();
  r.presets.subscribe(listener);
  r.history.transaction('Load and inspect', () => {
    r.presets.factory.load('warm');
    expect(r.presets.getSnapshot().factoryId).toBe('warm');
    expect(listener).not.toHaveBeenCalled();
  });
  expect(listener).toHaveBeenCalledOnce();
  r.dispose();
});
