import { cleanupTestContext, resetTestContext } from '@soundor/test-runtime';
import { aroundEach } from 'vitest';

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
