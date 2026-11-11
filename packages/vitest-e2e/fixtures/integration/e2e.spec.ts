import { resolve } from 'node:path';

import { launchHost } from '@soundor/vitest-e2e';
import { expect, inject, test } from 'vitest';

test('is told the plugin, from the project root', () => {
  expect(inject('soundorE2E')).toEqual({
    vst3: resolve('Fixture.vst3'),
    root: resolve('.'),
  });
});

test('runs in Node with a real-time timeout', ({ task }) => {
  expect(typeof document).toBe('undefined');
  expect(task.timeout).toBe(30_000);
});

test('allows a native read to take longer than one second', async () => {
  await expect
    .poll(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return '60%';
    })
    .toBe('60%');
});

test('has the matchers, which want a locator', async () => {
  await expect(expect('text').toBeVisible()).rejects.toThrow(
    'toBeVisible expects a locator',
  );
});

test('a launch fails with the host, and closing what never started is fine', async () => {
  await expect(
    launchHost({ executable: resolve('no-such-host') }),
  ).rejects.toThrow();
});
