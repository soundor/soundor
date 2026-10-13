import { expect, test, vi } from 'vitest';

import {
  initializeTestContext,
  getTestRuntime,
  resetTestContext,
  subscribeTestRuntime,
  registerTestCleanup,
  disposeTestContext,
} from './context';

test('resets all runtime state and keeps adapter subscriptions current', async () => {
  initializeTestContext();
  try {
    const first = getTestRuntime();
    const updates = vi.fn<() => void>();
    const unsubscribe = subscribeTestRuntime(updates);
    first.root.appendChild(first.create('view'));
    await resetTestContext();
    expect(first.isDisposed).toBe(true);
    expect(getTestRuntime()).not.toBe(first);
    expect(getTestRuntime().root.children).toEqual([]);
    expect(updates).toHaveBeenCalledTimes(2);
    unsubscribe();
    await resetTestContext();
    expect(updates).toHaveBeenCalledTimes(2);
  } finally {
    await disposeTestContext();
  }
});
test('cleanup runs every resource even after failures and disposes the runtime', async () => {
  initializeTestContext();
  const runtime = getTestRuntime();
  const order: number[] = [];
  registerTestCleanup(() => {
    order.push(1);
  });
  registerTestCleanup(() => {
    order.push(2);
    throw new Error('cleanup failure');
  });
  await expect(disposeTestContext()).rejects.toThrow(
    'Soundor test cleanup failed',
  );
  expect(order).toEqual([2, 1]);
  expect(runtime.isDisposed).toBe(true);
  expect(() => getTestRuntime()).toThrow('environment');
});
