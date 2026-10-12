import { registerTestCleanup } from '@soundor/test-runtime';
import { getTestRuntime } from '@soundor/vitest';
import { test, expect } from 'vitest';
let prior;
let cleaned = false;
test('intentional failure with resources', () => {
  prior = getTestRuntime();
  expect(prior.isDisposed).toBe(false);
  prior.root.appendChild(prior.create('input'));
  registerTestCleanup(() => {
    cleaned = true;
  });
  throw new Error('intentional test failure');
});
test('failure still tears down before the next test', () => {
  expect(cleaned).toBe(true);
  expect(prior.isDisposed).toBe(true);
  expect(getTestRuntime().root.children).toEqual([]);
});
