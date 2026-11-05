import * as ui from 'soundor:ui';
import { expect, test } from 'vitest';

test('runs in the simulated runtime', () => {
  expect(ui).toBeDefined();
});
