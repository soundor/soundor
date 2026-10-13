import { createTestRuntime, type TestRuntime } from './runtime';
import type { RuntimeOptions } from './services';

// A worker-global bridge also works when Node and Vite load separate module copies.
const key = Symbol.for('soundor.test-context.v1');
export interface TestContext {
  runtime: TestRuntime;
  options: RuntimeOptions;
  listeners: Set<(runtime: TestRuntime) => void>;
  cleanups: Set<() => void | Promise<void>>;
}
type ContextGlobal = typeof globalThis & { [key]?: TestContext };
export function testContext(global: ContextGlobal = globalThis): TestContext {
  const context = global[key];
  if (!context)
    throw new Error(
      'Soundor testing requires environment: "soundor" and plugins: [soundor()] in vitest.config.ts',
    );
  return context;
}
export function getTestRuntime(): TestRuntime {
  const runtime = testContext().runtime;
  runtime.assertActive();
  return runtime;
}
export function initializeTestContext(
  options: RuntimeOptions = {},
  global: ContextGlobal = globalThis,
): TestContext {
  if (global[key])
    throw new Error('Soundor test environment is already initialized');
  return (global[key] = {
    runtime: createTestRuntime(options),
    options,
    listeners: new Set(),
    cleanups: new Set(),
  });
}
export function subscribeTestRuntime(
  listener: (runtime: TestRuntime) => void,
): () => void {
  const context = testContext();
  context.listeners.add(listener);
  listener(context.runtime);
  return () => context.listeners.delete(listener);
}
export function registerTestCleanup(
  cleanup: () => void | Promise<void>,
): () => void {
  const context = testContext();
  context.cleanups.add(cleanup);
  return () => context.cleanups.delete(cleanup);
}
export async function cleanupTestContext(
  context = testContext(),
): Promise<void> {
  const errors: unknown[] = [];
  const cleanups = [...context.cleanups];
  context.cleanups.clear();
  for (const cleanup of cleanups.reverse()) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    context.runtime.dispose();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length)
    throw new AggregateError(errors, 'Soundor test cleanup failed');
}
export async function resetTestContext(): Promise<void> {
  const context = testContext();
  await cleanupTestContext(context);
  context.runtime = createTestRuntime(context.options);
  for (const listener of context.listeners) listener(context.runtime);
}
export async function disposeTestContext(
  global: ContextGlobal = globalThis,
): Promise<void> {
  const context = testContext(global);
  try {
    await cleanupTestContext(context);
  } finally {
    context.listeners.clear();
    delete global[key];
  }
}
