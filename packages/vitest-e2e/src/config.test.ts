import { mergeConfig } from 'vite';
import { expect, test } from 'vitest';
import type { ViteUserConfig } from 'vitest/config';

import { soundor } from './plugin';

async function configure(config: ViteUserConfig = {}) {
  const hook = soundor({ vst3: 'Fixture.vst3' }).config;
  if (typeof hook !== 'function') throw new Error('Expected config hook');
  const defaults = await hook.call({} as never, config, {
    command: 'serve',
    mode: 'test',
    isSsrBuild: false,
    isPreview: false,
  });
  return mergeConfig(config, defaults ?? {});
}

test('gives native polls five seconds by default', async () => {
  const config = await configure();
  expect(config.test?.expect?.poll?.timeout).toBe(5000);
});

test.each([0, 150, 8000])(
  'preserves an explicit poll timeout of %i ms',
  async (timeout) => {
    const config = await configure({
      test: { expect: { poll: { timeout } } },
    });
    expect(config.test?.expect?.poll?.timeout).toBe(timeout);
  },
);

test('preserves other assertion settings while defaulting the poll timeout', async () => {
  const config = await configure({
    test: { expect: { poll: { interval: 200 }, requireAssertions: true } },
  });
  expect(config.test?.expect).toEqual({
    poll: { interval: 200, timeout: 5000 },
    requireAssertions: true,
  });
});
