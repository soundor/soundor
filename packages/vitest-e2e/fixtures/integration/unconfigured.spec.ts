import { launchPlugin } from '@soundor/vitest-e2e';
import { expect, test } from 'vitest';

test('says what is missing', async () => {
  await expect(launchPlugin()).rejects.toThrow('Which plugin?');
});
