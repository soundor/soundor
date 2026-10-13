import {
  initializeTestContext,
  disposeTestContext,
  getTestRuntime,
  resetTestContext,
} from '@soundor/test-runtime';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { createFrames } from './frames';

let context: ReturnType<typeof initializeTestContext>;
beforeEach(() => {
  context = initializeTestContext();
});
afterEach(async () => {
  await disposeTestContext();
});
const interval = 1000 / 60;
test('snapshots native frame batches and defers nested requests', () => {
  const errors = vi.fn<(error: unknown) => void>();
  const frames = createFrames(context, errors);
  const order: string[] = [];
  let second: number;
  frames.requestAnimationFrame((time) => {
    expect(time).toBeCloseTo(interval);
    order.push('first');
    frames.cancelAnimationFrame(second);
    frames.requestAnimationFrame(() => {
      order.push('next');
    });
  });
  second = frames.requestAnimationFrame(() => {
    order.push('second');
  });
  const cancelled = frames.requestAnimationFrame(() => {
    order.push('cancelled');
  });
  frames.cancelAnimationFrame(cancelled);
  getTestRuntime().advanceTime(interval);
  expect(order).toEqual(['first', 'second']);
  getTestRuntime().advanceTime(interval);
  expect(order).toEqual(['first', 'second', 'next']);
  expect(errors).not.toHaveBeenCalled();
  expect(getTestRuntime().clock.pending).toBe(0);
});
test('reports callback errors without suppressing the remaining batch', () => {
  const errors = vi.fn<(error: unknown) => void>();
  const frames = createFrames(context, errors);
  const error = new Error('frame failed');
  const next = vi.fn<(time: number) => void>();
  frames.requestAnimationFrame(() => {
    throw error;
  });
  frames.requestAnimationFrame(next);
  getTestRuntime().advanceTime(interval);
  expect(errors).toHaveBeenCalledWith(error);
  expect(next).toHaveBeenCalledTimes(1);
});
test('cleans pending frames between tests and ignores stale handles', async () => {
  const frames = createFrames(context, vi.fn<(error: unknown) => void>());
  const old = vi.fn<(time: number) => void>();
  const stale = frames.requestAnimationFrame(old);
  const previous = getTestRuntime();
  await resetTestContext();
  expect(previous.clock.pending).toBe(0);
  const next = vi.fn<(time: number) => void>();
  const current = frames.requestAnimationFrame(next);
  expect(current).not.toBe(stale);
  frames.cancelAnimationFrame(stale);
  getTestRuntime().advanceTime(interval);
  expect(next).toHaveBeenCalledTimes(1);
  expect(old).not.toHaveBeenCalled();
});
test('bounds frame work and cleanup registrations across repeated requests', () => {
  const frames = createFrames(context, vi.fn<(error: unknown) => void>());
  for (let index = 0; index < 1000; index++) {
    const callback = vi.fn<(time: number) => void>();
    frames.requestAnimationFrame(callback);
    getTestRuntime().advanceTime(interval);
    expect(callback).toHaveBeenCalledTimes(1);
  }
  expect(getTestRuntime().clock.pending).toBe(0);
  expect(context.cleanups.size).toBe(1);
  expect(context.listeners.size).toBe(1);
  const id = frames.requestAnimationFrame(() => {});
  frames.cancelAnimationFrame(id);
  expect(getTestRuntime().clock.pending).toBe(0);
});
