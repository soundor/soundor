import { cleanupTestContext, resetTestContext } from '@soundor/test-runtime';
import { expect, aroundEach } from 'vitest';

import { soundorMatchers } from './matchers';

expect.extend(soundorMatchers);

aroundEach(async (runTest, context) => {
  if (context.task.concurrent)
    throw new Error(
      'Soundor tests in one file must run sequentially; parallel test files are supported. Remove test.concurrent.',
    );
  try {
    await resetTestContext();
    await runTest();
  } finally {
    await cleanupTestContext();
  }
});
