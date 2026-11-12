import { expect, it, vi } from 'vitest';

import { StateHistory } from './history';
import { describeState, StateStore } from './state';
function setup(history = new StateHistory()) {
  const store = new StateStore(
    describeState({
      counter: { type: 'int32', default: 0 },
      text: { type: 'string?', default: null },
      bands: { type: 'int32[]', default: [] },
    }),
    history,
  );
  return {
    history,
    store,
    a: store.fields.counter!,
    b: store.fields.text!,
    bands: store.fields.bands!,
  };
}
it('records opt-in writes with labels, updaters, replay, and redo invalidation', () => {
  const { history, a } = setup();
  a.set(1);
  expect(history.canUndo()).toBe(false);
  a.set((v: unknown) => Number(v) + 1, { history: true });
  a.set((v: unknown) => Number(v) + 1, { history: { label: 'Increment' } });
  expect(a.get()).toBe(3);
  expect(history.undoLabel()).toBe('Increment');
  history.undo();
  expect(a.get()).toBe(2);
  history.undo();
  expect(a.get()).toBe(1);
  history.redo();
  expect(a.get()).toBe(2);
  a.set(2, { history: true });
  expect(history.canRedo()).toBe(true);
  a.set(9, { history: true });
  expect(history.canRedo()).toBe(false);
});
it('groups History gestures at outer boundaries and keeps ordinary gestures independent', () => {
  const { history, a } = setup();
  a.beginGesture({ history: { label: 'Drag' } });
  a.beginGesture({ history: { label: 'Ignored' } });
  a.set(1, { history: true });
  a.set(2);
  a.endGesture();
  expect(history.canUndo()).toBe(false);
  a.endGesture();
  expect(history.undoLabel()).toBe('Drag');
  history.undo();
  expect(a.get()).toBe(0);
  a.beginGesture();
  a.set(1, { history: true });
  a.set(2, { history: true });
  a.endGesture();
  history.undo();
  expect(a.get()).toBe(1);
  history.undo();
  expect(a.get()).toBe(0);
  a.beginGesture({ history: true });
  a.set(4);
  a.set(0);
  a.endGesture();
  expect(history.canUndo()).toBe(false);
});
it('buffers transactions with read-your-writes and publishes all fields before observers', () => {
  const { history, store, a, b } = setup();
  const callback = vi.fn(() =>
    expect([a.get(), b.get()]).toEqual([2, 'Preset']),
  );
  a.subscribe(callback);
  b.subscribe(callback);
  history.transaction('Load', () => {
    a.set((v: unknown) => Number(v) + 1);
    a.set((v: unknown) => Number(v) + 1);
    b.set('Preset', { history: true });
    expect(a.get()).toBe(2);
    expect(store.snapshot().counter).toBe(0);
    expect(callback).not.toHaveBeenCalled();
  });
  expect(callback).toHaveBeenCalledTimes(2);
  expect(history.undoLabel()).toBe('Load');
  callback.mockImplementation(() =>
    expect([a.get(), b.get()]).toEqual([0, null]),
  );
  history.undo();
  expect([a.get(), b.get()]).toEqual([0, null]);
});
it('discards throws, caught setter errors, nested failures, async and thenable results', () => {
  const { history, a } = setup();
  const observe = vi.fn();
  a.subscribe(observe);
  const reason = new Error('bad');
  expect(() =>
    history.transaction('Fail', () => {
      a.set(3);
      throw reason;
    }),
  ).toThrow(reason);
  expect(() =>
    history.transaction('Fail', () => {
      try {
        a.set('bad');
      } catch {}
      a.set(4);
    }),
  ).toThrow(
    expect.objectContaining({
      name: 'TransactionAbortedError',
      cause: expect.any(TypeError),
    }),
  );
  expect(() =>
    history.transaction('Outer', () => {
      try {
        history.transaction('Inner', () => {
          throw reason;
        });
      } catch {}
      a.set(5);
    }),
  ).toThrow(expect.objectContaining({ cause: reason }));
  expect(() =>
    // @ts-expect-error Async callbacks are forbidden.
    history.transaction('Async', async () => {
      a.set(6);
    }),
  ).toThrow('synchronous');
  expect(() =>
    history.transaction('Thenable', (() => {
      a.set(7);
      return { then() {} };
    }) as () => unknown),
  ).toThrow('synchronous');
  expect(a.get()).toBe(0);
  expect(observe).not.toHaveBeenCalled();
  expect(history.canUndo()).toBe(false);
});
it('reuses nested buffers and outer label; no-op transactions retain redo', () => {
  const { history, a, b } = setup();
  history.transaction('Outer', () => {
    a.set(1);
    history.transaction('Inner', () => b.set('Hello'));
  });
  expect(history.undoLabel()).toBe('Outer');
  history.undo();
  history.transaction('Nothing', () => {
    a.set(1);
    a.set(0);
  });
  expect(history.canRedo()).toBe(true);
});
it('rejects gesture conflicts and lifecycle calls in transactions without cancelling gestures', () => {
  const { history, a, b } = setup();
  a.beginGesture({ history: true });
  a.set(2);
  expect(() => history.transaction('Conflict', () => a.set(5))).toThrow(
    'History gesture',
  );
  expect(a.get()).toBe(2);
  history.transaction('Other', () => b.set('OK'));
  expect(() => history.transaction('Begin', () => b.beginGesture())).toThrow(
    'inside a transaction',
  );
  expect(() => history.transaction('End', () => a.endGesture())).toThrow(
    'inside a transaction',
  );
  a.endGesture();
  history.undo();
  expect(a.get()).toBe(0);
});
it('rejects replay of owned fields but allows unrelated gestures', () => {
  const { history, a, b } = setup();
  b.set('A', { history: true });
  a.beginGesture({ history: true });
  history.undo();
  expect(b.get()).toBe(null);
  a.set(3);
  a.endGesture();
  a.beginGesture({ history: true });
  expect(() => history.undo()).toThrow('History gesture');
  a.endGesture();
  history.undo();
  expect(a.get()).toBe(0);
});
it('detaches arrays and clears History on restoration', () => {
  const { history, store, bands } = setup();
  const value = [1, 2];
  bands.set(value, { history: true });
  value.push(3);
  expect(bands.get()).toEqual([1, 2]);
  expect(Object.isFrozen(bands.get())).toBe(true);
  history.undo();
  expect(bands.get()).toEqual([]);
  history.redo();
  expect(bands.get()).toEqual([1, 2]);
  store.restore(store.prepare({ counter: 9, bands: [5] }));
  expect(history.canUndo()).toBe(false);
  expect(history.canRedo()).toBe(false);
});
it('bounds memory and entry count and avoids redundant status notifications', () => {
  const { history, a } = setup(new StateHistory(2));
  const listener = vi.fn();
  history.subscribe(listener);
  a.set(1, { history: true });
  a.set(2, { history: true });
  a.set(3, { history: true });
  expect(listener).toHaveBeenCalledTimes(3);
  history.undo();
  history.undo();
  expect(a.get()).toBe(1);
  expect(history.canUndo()).toBe(false);
  const small = setup(new StateHistory(100, 1));
  small.a.set(1, { history: true });
  expect(small.history.canUndo()).toBe(false);
});

it('a changed unrecorded user edit invalidates redo while an empty History gesture preserves it', () => {
  const { history, a } = setup();
  a.set(1, { history: true });
  history.undo();
  a.beginGesture({ history: true });
  a.set(2);
  a.set(0);
  a.endGesture();
  expect(history.canRedo()).toBe(true);
  a.set(3);
  expect(history.canRedo()).toBe(false);
  expect(history.canUndo()).toBe(false);
});
it('prepares the complete replay before changing values or stacks', () => {
  const history = new StateHistory();
  let value = 0,
    fail = false;
  history.register({
    id: 'test',
    label: 'Test',
    read: () => value,
    equal: Object.is,
    prepare: (next) => {
      if (fail) throw new Error('Cannot prepare');
      return {
        install: () => {
          value = Number(next);
        },
        notify() {},
      };
    },
  });
  history.edit('test', () => 1, { history: true });
  fail = true;
  expect(() => history.undo()).toThrow('Cannot prepare');
  expect(value).toBe(1);
  expect(history.canUndo()).toBe(true);
  expect(history.canRedo()).toBe(false);
  fail = false;
  history.undo();
  expect(value).toBe(0);
});
it('records a gesture completed by a synchronous field subscriber', () => {
  const { history, a } = setup();
  a.subscribe(() => a.endGesture());
  a.beginGesture({ history: { label: 'Edit' } });
  a.set(2);
  expect(history.undoLabel()).toBe('Edit');
  history.undo();
  expect(a.get()).toBe(0);
});
