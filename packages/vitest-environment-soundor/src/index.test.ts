import {
  getTestRuntime,
  initializeTestContext,
  disposeTestContext,
  TestResizeObserver,
} from '@soundor/test-runtime';
import { expect, test, vi } from 'vitest';

import environment from './index';

test('rejects a missing plugin', () => {
  expect(() => environment.setup({}, {})).toThrow('plugins: [soundor()]');
});
test('initializes and tears down a worker', async () => {
  const global = {};
  const lifecycle = environment.setup(global, {
    soundor: { configured: true, runtime: {} },
  });
  expect(lifecycle.teardown).toBeTypeOf('function');
  await lifecycle.teardown();
  const again = environment.setup(global, {
    soundor: { configured: true, runtime: {} },
  });
  await again.teardown();
});
test('errors outside the environment are actionable', () => {
  expect(() => getTestRuntime()).toThrow('environment: "soundor"');
});
test('worker context exposes the runtime until disposal', async () => {
  initializeTestContext();
  const runtime = getTestRuntime();
  expect(runtime.root.children).toEqual([]);
  await disposeTestContext();
  expect(runtime.isDisposed).toBe(true);
});

test('reports errors asynchronously and restores the worker global', async () => {
  const queued = vi.fn<(callback: () => void) => void>();
  const sandbox: {
    queueMicrotask: typeof queued;
    reportError?: (error: unknown) => void;
  } = { queueMicrotask: queued };
  const lifecycle = environment.setup(sandbox, {
    soundor: { configured: true, runtime: {} },
  });
  const error = new Error('component failed');
  sandbox.reportError!(error);
  expect(queued).toHaveBeenCalledTimes(1);
  expect(() => queued.mock.calls[0]![0]()).toThrow(error);
  await lifecycle.teardown();
  expect(sandbox.reportError).toBeUndefined();
});
test('preserves an existing reportError implementation', async () => {
  const reportError = vi.fn<(error: unknown) => void>();
  const sandbox = { reportError };
  const lifecycle = environment.setup(sandbox, {
    soundor: { configured: true, runtime: {} },
  });
  expect(sandbox.reportError).toBe(reportError);
  await lifecycle.teardown();
  expect(sandbox.reportError).toBe(reportError);
});

test('restores frame globals and exposes a read-only simulated pixel ratio', async () => {
  const sandbox: {
    requestAnimationFrame?: (callback: (time: number) => void) => number;
    cancelAnimationFrame?: (id: number) => void;
    devicePixelRatio?: number;
  } = {};
  const lifecycle = environment.setup(sandbox, {
    soundor: { configured: true, runtime: {} },
  });
  expect(sandbox.requestAnimationFrame).toBeTypeOf('function');
  expect(sandbox.cancelAnimationFrame).toBeTypeOf('function');
  expect(sandbox.devicePixelRatio).toBe(1);
  expect(
    Object.getOwnPropertyDescriptor(sandbox, 'devicePixelRatio')?.writable,
  ).toBe(false);
  await lifecycle.teardown();
  expect(sandbox.requestAnimationFrame).toBeUndefined();
  expect(sandbox.cancelAnimationFrame).toBeUndefined();
  expect(sandbox.devicePixelRatio).toBeUndefined();
});

test('installs a ResizeObserver that observes nodes and, with no layout, never tells', async () => {
  const sandbox: { ResizeObserver?: typeof TestResizeObserver } = {};
  const lifecycle = environment.setup(sandbox, {
    soundor: { configured: true, runtime: {} },
  });
  expect(sandbox.ResizeObserver).toBe(TestResizeObserver);
  const observer = new TestResizeObserver(() => {});
  expect(() => observer.observe({})).toThrow('not a UiNode');
  await lifecycle.teardown();
  expect(sandbox.ResizeObserver).toBeUndefined();
});
