import { expect, test } from 'vitest';

import { soundorMatchers } from './matchers';

test('focus assertions require the configured Soundor test environment', () => {
  expect(() => soundorMatchers.toHaveFocus({})).toThrow(
    'Soundor testing requires environment: "soundor" and plugins: [soundor()]',
  );
});
